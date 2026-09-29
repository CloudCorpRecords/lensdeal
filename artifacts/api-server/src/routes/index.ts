import { Router, type IRouter } from "express";
import healthRouter from "./health";
import screenRouter from "./screen";

const router: IRouter = Router();

router.use(healthRouter);
router.use(screenRouter);

export default router;
