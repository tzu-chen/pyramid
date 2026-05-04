import { Router, Request, Response } from 'express';
import {
  listGodboltCompilers,
  compileWithGodbolt,
  type GodboltFilters,
} from '../services/godbolt.js';

const router = Router();

const MAX_SOURCE_BYTES = 256 * 1024;

router.get('/compilers', async (req: Request, res: Response) => {
  try {
    const lang = typeof req.query.lang === 'string' && req.query.lang ? req.query.lang : 'c++';
    const compilers = await listGodboltCompilers(lang);
    res.json({ language: lang, compilers });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.post('/compile', async (req: Request, res: Response) => {
  try {
    const { compilerId, source, userArguments, filters } = req.body ?? {};
    if (typeof compilerId !== 'string' || !compilerId.trim()) {
      res.status(400).json({ error: 'compilerId is required' });
      return;
    }
    if (typeof source !== 'string' || !source.trim()) {
      res.status(400).json({ error: 'source is required' });
      return;
    }
    if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
      res.status(413).json({ error: `source exceeds ${MAX_SOURCE_BYTES} bytes` });
      return;
    }

    const result = await compileWithGodbolt({
      compilerId: compilerId.trim(),
      source,
      userArguments: typeof userArguments === 'string' ? userArguments : '',
      filters: filters as GodboltFilters | undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

export default router;
