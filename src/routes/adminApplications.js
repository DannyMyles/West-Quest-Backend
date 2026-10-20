import { Router } from "express";
import { parse } from "../errors.js";
import { applicationListQuerySchema, applicationUpdateSchema, idParam } from "../schemas.js";
import { getApplication, listApplications, updateApplication } from "../services/applications.js";

/** Reviewing and moderating financing applications — the admin equivalent of orders. */
export function adminApplicationsRouter({ pool }) {
  const r = Router();

  r.get("/applications", async (req, res) => {
    res.json(await listApplications(pool, parse(applicationListQuerySchema, req.query)));
  });

  r.get("/applications/:id", async (req, res) => {
    res.json(await getApplication(pool, parse(idParam, req.params).id));
  });

  r.patch("/applications/:id", async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await updateApplication(pool, id, parse(applicationUpdateSchema, req.body)));
  });

  return r;
}
