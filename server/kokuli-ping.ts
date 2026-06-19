import { Router, Request, Response } from "express";

const router = Router();

// GET /kokuli/ping — simple liveness check
router.get("/kokuli/ping", (_req: Request, res: Response) => {
  res.json({ pong: true, timestamp: Date.now() });
});

export default router;
