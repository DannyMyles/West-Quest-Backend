import { Router } from "express";
import { parse } from "../errors.js";
import { idParam, orderListQuerySchema, orderUpdateSchema } from "../schemas.js";
import { getOrder, listOrders, updateOrder } from "../services/orders.js";

/** Cash (pay-in-full) orders placed through checkout. */
export function adminOrdersRouter({ pool }) {
  const r = Router();

  r.get("/orders", async (req, res) => {
    res.json(await listOrders(pool, parse(orderListQuerySchema, req.query)));
  });

  r.get("/orders/:id", async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await getOrder(pool, id));
  });

  r.patch("/orders/:id", async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await updateOrder(pool, id, parse(orderUpdateSchema, req.body)));
  });

  return r;
}
