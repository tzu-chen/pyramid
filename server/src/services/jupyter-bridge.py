#!/usr/bin/env python3
"""
Jupyter kernel bridge for Pyramid notebook sessions.

Spawns an IPython kernel via jupyter_client and relays messages between
the kernel's ZMQ channels and Node.js over stdin/stdout using
line-delimited JSON.

Commands (stdin, one JSON object per line):
  {"cmd": "execute", "msg_id": "<uuid>", "code": "<source>"}
  {"cmd": "interrupt"}
  {"cmd": "restart"}
  {"cmd": "shutdown"}

Events (stdout, one JSON object per line):
  {"type": "ready"}
  {"type": "status", "parent_msg_id": "...", "state": "busy"|"idle"}
  {"type": "stream", "parent_msg_id": "...", "name": "stdout"|"stderr", "text": "..."}
  {"type": "execute_result", "parent_msg_id": "...", "execution_count": N, "data": {<mime>: ...}}
  {"type": "display_data", "parent_msg_id": "...", "data": {<mime>: ...}}
  {"type": "error", "parent_msg_id": "...", "ename": "...", "evalue": "...", "traceback": [...]}
  {"type": "execute_reply", "parent_msg_id": "...", "status": "ok"|"error", "execution_count": N}
  {"type": "kernel_exit"}
"""

import json
import sys
import threading
import os

try:
    from jupyter_client.manager import KernelManager
except ImportError:
    sys.stderr.write("jupyter_client not installed. Run: pip install jupyter_client ipykernel\n")
    sys.exit(1)


# --- Per-cell memory sampling -------------------------------------------------
#
# The kernel is a long-lived process, so the meaningful per-cell number is the
# peak resident set size (RSS) observed while the cell runs, plus the delta from
# the RSS at cell start. We poll /proc/<pid>/status:VmRSS on a background thread
# between the execute_request and its execute_reply. VmHWM is unusable here
# because it's a lifetime high-water mark, not per-cell. Linux-only; on other
# platforms reads return None and we report null.

EXEC_SAMPLERS = {}        # msg_id -> RssSampler
EXEC_SAMPLERS_LOCK = threading.Lock()


def kernel_pid(km):
    # jupyter_client moved kernels behind provisioners in v7; try both shapes.
    try:
        prov = getattr(km, "provisioner", None)
        if prov is not None and getattr(prov, "pid", None):
            return prov.pid
    except Exception:
        pass
    try:
        k = getattr(km, "kernel", None)
        if k is not None and getattr(k, "pid", None):
            return k.pid
    except Exception:
        pass
    return None


def read_rss_bytes(pid):
    try:
        with open("/proc/%d/status" % pid) as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    # "VmRSS:   12345 kB" — the kB label is really KiB.
                    return int(line.split()[1]) * 1024
    except Exception:
        return None
    return None


class RssSampler(threading.Thread):
    def __init__(self, pid):
        super().__init__(daemon=True)
        self.pid = pid
        self._stop = threading.Event()
        self.baseline = read_rss_bytes(pid)
        self.peak = self.baseline or 0

    def run(self):
        while not self._stop.wait(0.03):
            r = read_rss_bytes(self.pid)
            if r is not None and r > self.peak:
                self.peak = r

    def stop(self):
        self._stop.set()
        r = read_rss_bytes(self.pid)
        if r is not None and r > self.peak:
            self.peak = r
        return self.peak, self.baseline


# Msg IDs for inspect requests. iopub stream output for these msg IDs is
# captured into INSPECT_BUFFERS instead of being broadcast, and an
# `inspect_reply` event is emitted on execute_reply.
INSPECT_MSG_IDS = set()
INSPECT_BUFFERS = {}

INSPECT_CODE = r'''
def __pyramid_inspect():
    import json as _json
    import sys as _sys
    _skip = {'In', 'Out', 'exit', 'quit', 'get_ipython'}
    _skip_types = {'module', 'function', 'builtin_function_or_method', 'type',
                   'method', 'method-wrapper', 'classobj', 'staticmethod',
                   'classmethod', 'MethodType'}
    _out = []
    for _name in list(globals().keys()):
        if _name.startswith('_'): continue
        if _name in _skip: continue
        try:
            _obj = globals()[_name]
            _tname = type(_obj).__name__
            if _tname in _skip_types: continue
            try:
                _repr = repr(_obj)
            except Exception:
                _repr = '<unrepresentable>'
            if len(_repr) > 240:
                _repr = _repr[:240] + '...'
            _shape = None
            try:
                if hasattr(_obj, 'shape'):
                    _shape = str(getattr(_obj, 'shape'))
                elif hasattr(_obj, '__len__'):
                    _shape = 'len=' + str(len(_obj))
            except Exception:
                pass
            _size = None
            try:
                _size = _sys.getsizeof(_obj)
            except Exception:
                pass
            _out.append({
                'name': _name,
                'type': _tname,
                'repr': _repr,
                'shape': _shape,
                'size': _size,
            })
        except Exception:
            pass
    _sys.stdout.write(_json.dumps(_out))
    _sys.stdout.flush()
__pyramid_inspect()
del __pyramid_inspect
'''


def emit(event):
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


def iopub_loop(kc):
    while True:
        try:
            msg = kc.get_iopub_msg(timeout=None)
        except Exception:
            return
        mtype = msg.get("msg_type")
        parent_id = msg.get("parent_header", {}).get("msg_id", "")
        content = msg.get("content", {})
        # Inspect requests capture their own stdout into INSPECT_BUFFERS and
        # never broadcast iopub events to clients (avoids polluting cell outputs).
        if parent_id in INSPECT_MSG_IDS:
            if mtype == "stream" and content.get("name") == "stdout":
                INSPECT_BUFFERS.setdefault(parent_id, []).append(content.get("text", ""))
            elif mtype == "error":
                # Surface kernel errors so the client can show something instead of hanging
                INSPECT_BUFFERS[parent_id + ":__error__"] = content.get("evalue", "inspect failed")
            continue
        if mtype == "status":
            emit({"type": "status", "parent_msg_id": parent_id, "state": content.get("execution_state")})
        elif mtype == "stream":
            emit({"type": "stream", "parent_msg_id": parent_id,
                  "name": content.get("name", "stdout"),
                  "text": content.get("text", "")})
        elif mtype == "execute_result":
            emit({"type": "execute_result", "parent_msg_id": parent_id,
                  "execution_count": content.get("execution_count"),
                  "data": content.get("data", {})})
        elif mtype == "display_data":
            emit({"type": "display_data", "parent_msg_id": parent_id,
                  "data": content.get("data", {})})
        elif mtype == "error":
            emit({"type": "error", "parent_msg_id": parent_id,
                  "ename": content.get("ename", ""),
                  "evalue": content.get("evalue", ""),
                  "traceback": content.get("traceback", [])})
        elif mtype == "clear_output":
            emit({"type": "clear_output", "parent_msg_id": parent_id,
                  "wait": content.get("wait", False)})


def shell_loop(kc):
    while True:
        try:
            msg = kc.get_shell_msg(timeout=None)
        except Exception:
            return
        mtype = msg.get("msg_type")
        parent_id = msg.get("parent_header", {}).get("msg_id", "")
        content = msg.get("content", {})
        if parent_id in INSPECT_MSG_IDS and mtype == "execute_reply":
            INSPECT_MSG_IDS.discard(parent_id)
            err_key = parent_id + ":__error__"
            if err_key in INSPECT_BUFFERS:
                err = INSPECT_BUFFERS.pop(err_key)
                INSPECT_BUFFERS.pop(parent_id, None)
                emit({"type": "inspect_reply", "parent_msg_id": parent_id,
                      "variables": [], "error": err})
            else:
                text = "".join(INSPECT_BUFFERS.pop(parent_id, []))
                try:
                    data = json.loads(text) if text.strip() else []
                except Exception as e:
                    data = []
                    emit({"type": "inspect_reply", "parent_msg_id": parent_id,
                          "variables": [], "error": "parse error: " + str(e)})
                    continue
                emit({"type": "inspect_reply", "parent_msg_id": parent_id,
                      "variables": data})
            continue
        if mtype == "execute_reply":
            peak_rss = None
            rss_delta = None
            with EXEC_SAMPLERS_LOCK:
                sampler = EXEC_SAMPLERS.pop(parent_id, None)
            if sampler is not None:
                peak, baseline = sampler.stop()
                if peak:
                    peak_rss = peak
                    if baseline is not None:
                        rss_delta = peak - baseline
            emit({"type": "execute_reply", "parent_msg_id": parent_id,
                  "status": content.get("status"),
                  "execution_count": content.get("execution_count"),
                  "peak_rss": peak_rss,
                  "rss_delta": rss_delta})
        elif mtype == "complete_reply":
            emit({"type": "complete_reply", "parent_msg_id": parent_id,
                  "matches": content.get("matches", []),
                  "cursor_start": content.get("cursor_start", 0),
                  "cursor_end": content.get("cursor_end", 0),
                  "metadata": content.get("metadata", {}),
                  "status": content.get("status", "ok")})


def main():
    cwd = os.environ.get("PYRAMID_NOTEBOOK_CWD", os.getcwd())
    km = KernelManager(kernel_name="python3")
    # Launch the kernel from the session's uv venv when one was provided, so the
    # notebook sees the venv's packages. We keep this bridge on the stable
    # interpreter and only redirect the kernel argv (the venv must have ipykernel
    # installed; if not, wait_for_ready below times out and surfaces an error).
    venv_python = os.environ.get("PYRAMID_VENV_PYTHON")
    if venv_python and os.path.exists(venv_python):
        ks = km.kernel_spec  # loads the default python3 spec object
        ks.argv = [venv_python, "-m", "ipykernel_launcher", "-f", "{connection_file}"]
    km.start_kernel(cwd=cwd)
    kc = km.client()
    kc.start_channels()
    try:
        kc.wait_for_ready(timeout=30)
    except Exception as e:
        emit({"type": "error", "parent_msg_id": "", "ename": "KernelStartupError",
              "evalue": str(e), "traceback": []})
        sys.exit(1)

    emit({"type": "ready"})

    threading.Thread(target=iopub_loop, args=(kc,), daemon=True).start()
    threading.Thread(target=shell_loop, args=(kc,), daemon=True).start()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        cmd = req.get("cmd")
        if cmd == "execute":
            client_msg_id = req.get("msg_id", "")
            code = req.get("code", "")
            # Use jupyter_client's execute so it generates a msg_id we can map.
            # We actually want to control the msg_id; use session.send via shell_channel.
            msg = kc.session.msg("execute_request", content={
                "code": code, "silent": False, "store_history": True,
                "user_expressions": {}, "allow_stdin": False, "stop_on_error": True,
            })
            # Overwrite msg_id with the one supplied by Node so event correlation is simple
            if client_msg_id:
                msg["header"]["msg_id"] = client_msg_id
                msg["msg_id"] = client_msg_id
            # Start sampling the kernel's RSS for the duration of this cell.
            pid = kernel_pid(km)
            if client_msg_id and pid:
                sampler = RssSampler(pid)
                with EXEC_SAMPLERS_LOCK:
                    EXEC_SAMPLERS[client_msg_id] = sampler
                sampler.start()
            kc.shell_channel.send(msg)
        elif cmd == "inspect":
            client_msg_id = req.get("msg_id", "")
            INSPECT_MSG_IDS.add(client_msg_id)
            msg = kc.session.msg("execute_request", content={
                "code": INSPECT_CODE,
                "silent": False, "store_history": False,
                "user_expressions": {}, "allow_stdin": False, "stop_on_error": True,
            })
            if client_msg_id:
                msg["header"]["msg_id"] = client_msg_id
                msg["msg_id"] = client_msg_id
            kc.shell_channel.send(msg)
        elif cmd == "complete":
            client_msg_id = req.get("msg_id", "")
            code = req.get("code", "")
            cursor_pos = int(req.get("cursor_pos", 0))
            msg = kc.session.msg("complete_request", content={
                "code": code, "cursor_pos": cursor_pos,
            })
            if client_msg_id:
                msg["header"]["msg_id"] = client_msg_id
                msg["msg_id"] = client_msg_id
            kc.shell_channel.send(msg)
        elif cmd == "interrupt":
            try:
                km.interrupt_kernel()
            except Exception:
                pass
        elif cmd == "restart":
            # Drop any in-flight samplers; their pid is about to go away and the
            # matching execute_reply may never arrive.
            with EXEC_SAMPLERS_LOCK:
                for s in EXEC_SAMPLERS.values():
                    s.stop()
                EXEC_SAMPLERS.clear()
            try:
                km.restart_kernel(now=False)
                try: kc.wait_for_ready(timeout=30)
                except Exception: pass
                emit({"type": "ready"})
            except Exception as e:
                emit({"type": "error", "parent_msg_id": "", "ename": "RestartError",
                      "evalue": str(e), "traceback": []})
        elif cmd == "shutdown":
            break

    try: kc.stop_channels()
    except Exception: pass
    try: km.shutdown_kernel(now=True)
    except Exception: pass
    emit({"type": "kernel_exit"})


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
