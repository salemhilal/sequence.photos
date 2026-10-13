// The Worker: routes requests to handlers, and runs the scheduled sweep.

import { callback, redeem, renew } from './auth';
import { getFrame } from './frames';
import { dataDeletion, deauthorize, deletionStatus } from './meta';
import { handleRequest, type RouteDef } from './router';
import { runSweep } from './sweep';
import { createBatch, deleteBatch, putFrame } from './uploads';

const ID = '(?<id>[^/]+)';
const INDEX = '(?<i>[^/]+)';

export const ROUTE_TABLE: readonly RouteDef[] = [
  {
    method: 'GET',
    path: /^\/auth\/callback$/,
    route: 'GET /auth/callback',
    handler: callback,
  },
  {
    method: 'POST',
    path: /^\/auth\/redeem$/,
    route: 'POST /auth/redeem',
    preflight: 'OPTIONS /auth/redeem',
    handler: redeem,
  },
  {
    method: 'POST',
    path: /^\/auth\/renew$/,
    route: 'POST /auth/renew',
    preflight: 'OPTIONS /auth/renew',
    handler: renew,
  },
  {
    method: 'POST',
    path: /^\/uploads$/,
    route: 'POST /uploads',
    preflight: 'OPTIONS /uploads',
    handler: createBatch,
  },
  {
    method: 'PUT',
    path: new RegExp(`^/uploads/${ID}/${INDEX}\\.jpg$`),
    route: 'PUT /uploads/:id/:i.jpg',
    preflight: 'OPTIONS /uploads/:id/:i.jpg',
    handler: putFrame,
  },
  {
    method: 'DELETE',
    path: new RegExp(`^/uploads/${ID}$`),
    route: 'DELETE /uploads/:id',
    preflight: 'OPTIONS /uploads/:id',
    handler: deleteBatch,
  },
  {
    method: 'GET',
    path: new RegExp(`^/frames/${ID}/${INDEX}\\.jpg$`),
    route: 'GET /frames/:id/:i.jpg',
    handler: getFrame,
  },
  {
    method: 'HEAD',
    path: new RegExp(`^/frames/${ID}/${INDEX}\\.jpg$`),
    route: 'HEAD /frames/:id/:i.jpg',
    handler: getFrame,
  },
  {
    method: 'POST',
    path: /^\/meta\/deauthorize$/,
    route: 'POST /meta/deauthorize',
    handler: deauthorize,
  },
  {
    method: 'POST',
    path: /^\/meta\/data-deletion$/,
    route: 'POST /meta/data-deletion',
    handler: dataDeletion,
  },
  {
    method: 'GET',
    path: /^\/meta\/deletion$/,
    route: 'GET /meta/deletion',
    handler: deletionStatus,
  },
];

export default {
  fetch(request, env) {
    return handleRequest(request, env, ROUTE_TABLE);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runSweep(env));
  },
} satisfies ExportedHandler<Env>;
