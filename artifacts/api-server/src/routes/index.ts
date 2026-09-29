import { Router, type IRouter } from "express";
import healthRouter from "./health";
import screenRouter from "./screen";
import billingRouter from "./billing";
import compilationRouter from "./compilations";
import explanationRouter from "./explanations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(billingRouter);
router.use(screenRouter);
router.use(compilationRouter);
router.use(explanationRouter);

export default router;
