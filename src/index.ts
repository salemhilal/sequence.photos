// The Worker: routes requests to handlers, and runs the scheduled sweep.

import { callback, redeem, renew } from './auth';
import { handleRequest, HttpError, type Handler, type RouteDef } from './http';

// Filled in by later milestones.
const notImplemented: Handler = () => Promise.reject(new HttpError(501, 'not_implemented'));

const ID = '(?<id>[^/]+)';
const INDEX = '(?<i>[^/]+)';

export const ROUTE_TABLE: readonly RouteDef[] = [
  {
    method: 'GET',
    path: /^\/auth\/callback$/,
    route: 'GET /auth/callback',
    cors: false,
    handler: callback,
  },
  {
    method: 'POST',
    path: /^\/auth\/redeem$/,
    route: 'POST /auth/redeem',
    cors: true,
    preflightRoute: 'OPTIONS /auth/redeem',
    handler: redeem,
  },
  {
    method: 'POST',
    path: /^\/auth\/renew$/,
    route: 'POST /auth/renew',
    cors: true,
    preflightRoute: 'OPTIONS /auth/renew',
    handler: renew,
  },
  {
    method: 'POST',
    path: /^\/uploads$/,
    route: 'POST /uploads',
    cors: true,
    preflightRoute: 'OPTIONS /uploads',
    handler: notImplemented,
  },
  {
    method: 'PUT',
    path: new RegExp(`^/uploads/${ID}/${INDEX}\\.jpg$`),
    route: 'PUT /uploads/:id/:i.jpg',
    cors: true,
    preflightRoute: 'OPTIONS /uploads/:id/:i.jpg',
    handler: notImplemented,
  },
  {
    method: 'DELETE',
    path: new RegExp(`^/uploads/${ID}$`),
    route: 'DELETE /uploads/:id',
    cors: true,
    preflightRoute: 'OPTIONS /uploads/:id',
    handler: notImplemented,
  },
  {
    method: 'GET',
    path: new RegExp(`^/frames/${ID}/${INDEX}\\.jpg$`),
    route: 'GET /frames/:id/:i.jpg',
    cors: false,
    handler: notImplemented,
  },
  {
    method: 'POST',
    path: /^\/meta\/deauthorize$/,
    route: 'POST /meta/deauthorize',
    cors: false,
    handler: notImplemented,
  },
  {
    method: 'POST',
    path: /^\/meta\/data-deletion$/,
    route: 'POST /meta/data-deletion',
    cors: false,
    handler: notImplemented,
  },
  {
    method: 'GET',
    path: /^\/meta\/deletion$/,
    route: 'GET /meta/deletion',
    cors: false,
    handler: notImplemented,
  },
];

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx, ROUTE_TABLE);
  },
  async scheduled() {
    // The sweep (milestone 3).
  },
} satisfies ExportedHandler<Env>;
