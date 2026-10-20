import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { ImageStore } from "./lib/imageStore.js";
import { createNotifier } from "./lib/notify.js";
import { adminUsersRouter } from "./routes/adminUsers.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { apiLimiter, corsMiddleware, originGuard } from "./middleware/security.js";
import { requireAdmin } from "./middleware/auth.js";
import { publicRouter } from "./routes/public.js";
import { authRouter } from "./routes/auth.js";
import { publicReviewsRouter } from "./routes/publicReviews.js";
import { adminStoreRouter } from "./routes/adminStore.js";
import { adminProductsRouter } from "./routes/adminProducts.js";
import { adminCategoriesRouter } from "./routes/adminCategories.js";
import { adminImagesRouter } from "./routes/adminImages.js";
import { adminApplicationsRouter } from "./routes/adminApplications.js";
import { imageFilesRouter } from "./routes/imageFiles.js";
import { accountRouter } from "./routes/account.js";
import { adminOrdersRouter } from "./routes/adminOrders.js";

/**
 * Builds the Express app. Dependencies are injected so tests can point it at a
 * throwaway database and database.
 */
export function createApp({ config, pool, options = {} }) {
  const images = new ImageStore({ pool, publicUrl: config.publicUrl });
  const notifier = createNotifier(config, { transport: options.mailTransport });
  const ctx = { config, pool, images, notifier };

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  // Photos are loaded cross-origin by the storefront <img> tags.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(corsMiddleware(config));

  app.use("/images", imageFilesRouter(ctx));

  app.use("/api", apiLimiter(options.apiRateLimit));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.use("/api", publicRouter(ctx));
  app.use("/api", publicReviewsRouter(ctx, options));
  app.use("/api/account", accountRouter(ctx, options));

  const admin = express.Router();
  admin.use(originGuard(config));
  admin.use("/auth", authRouter(ctx, { loginAttempts: options.loginAttempts }));
  admin.use(requireAdmin(ctx)); // everything below needs a signed-in admin
  admin.use(adminProductsRouter(ctx));
  admin.use(adminCategoriesRouter(ctx));
  admin.use(adminImagesRouter(ctx));
  admin.use(adminApplicationsRouter(ctx));
  admin.use(adminOrdersRouter(ctx));
  admin.use(adminStoreRouter(ctx));
  admin.use(adminUsersRouter(ctx));
  app.use("/api/admin/", admin);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
