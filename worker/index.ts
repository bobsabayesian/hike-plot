import { handleApi } from './api';
import { handleProjects, type Bucket } from './projects';

interface Env { ASSETS: { fetch: (req: Request) => Promise<Response> }; PROJECTS?: Bucket }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return (await handleProjects(req, env.PROJECTS)) ?? (await handleApi(req)) ?? env.ASSETS.fetch(req);
  },
};
