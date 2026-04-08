import { Router, Request, Response } from 'express';
import { fetchScribeNode, searchScribeNodes, listScribeFlowcharts } from '../services/scribe.js';

const router = Router();

// GET /api/scribe/flowcharts
router.get('/flowcharts', async (_req: Request, res: Response) => {
  try {
    const flowcharts = await listScribeFlowcharts();
    res.json(flowcharts);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/scribe/nodes/search?title=X
router.get('/nodes/search', async (req: Request, res: Response) => {
  try {
    const title = typeof req.query.title === 'string' ? req.query.title : '';
    if (!title) {
      res.status(400).json({ error: 'title query parameter is required' });
      return;
    }
    const nodes = await searchScribeNodes(title);
    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/scribe/nodes/:flowchartId/:nodeKey
router.get('/nodes/:flowchartId/:nodeKey', async (req: Request, res: Response) => {
  try {
    const node = await fetchScribeNode(req.params.flowchartId as string, req.params.nodeKey as string);
    if (!node) {
      res.status(404).json({ error: 'Node not found or Scribe unavailable' });
      return;
    }
    res.json(node);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
