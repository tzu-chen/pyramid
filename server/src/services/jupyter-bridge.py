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
        if mtype == "execute_reply":
            emit({"type": "execute_reply", "parent_msg_id": parent_id,
                  "status": content.get("status"),
                  "execution_count": content.get("execution_count")})
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
