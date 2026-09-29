import { Router, type IRouter } from "express";
import { DiscoverStartupsQueryParams, DiscoverStartupsResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { browseTrustMrr, DiscoveryError } from "../lib/trustmrr";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/discover/startups", async (req, res): Promise<void> => {
  const parsed = DiscoverStartupsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose valid discovery filters and a page from 1 to 20." });
    return;
  }
  const apiKey = process.env.TRUSTMRR_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Company discovery is not configured yet. Enter a domain manually for now." });
    return;
  }
  try {
    res.json(DiscoverStartupsResponse.parse(await browseTrustMrr(parsed.data, apiKey)));
  } catch (error) {
    if (error instanceof DiscoveryError) {
      if (error.retryAfter) res.setHeader("Retry-After", String(error.retryAfter));
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "TrustMRR discovery failed");
    res.status(503).json({ error: "Company discovery is unavailable. Enter a domain manually or try again later." });
  }
});

export default router;