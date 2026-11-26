import {afterEach, expect, it} from 'vitest';
import {createServer, type Server} from 'node:http';
import {localResearch} from '../apps/server/local-research.js';

const original = process.env.INFRARED_RESEARCH_TOKEN;
let server: Server | undefined;
afterEach(async () => {
  process.env.INFRARED_RESEARCH_TOKEN = original;
  if (original === undefined) delete process.env.INFRARED_RESEARCH_TOKEN;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

// The warm research process listens on a fixed loopback port; skip when it is already in use.
async function fakeService(status: number) {
  const s = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(status, {'content-type': 'application/json'});
      res.end('{}');
    });
  });
  const ok = await new Promise<boolean>((resolve) => {
    s.once('error', () => resolve(false));
    s.listen(8765, '127.0.0.1', () => resolve(true));
  });
  if (ok) server = s;
  return ok;
}

it('reports a busy warm research process as a retryable 429, and other failures as unavailable', async (ctx) => {
  process.env.INFRARED_RESEARCH_TOKEN = 'x'.repeat(40);
  if (!(await fakeService(429))) return ctx.skip();
  await expect(localResearch('experiment', Buffer.from('{}'))).rejects.toMatchObject({status: 429, code: 'INTELLIGENCE_RESEARCH_BUSY'});
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  if (!(await fakeService(500))) return ctx.skip();
  await expect(localResearch('experiment', Buffer.from('{}'))).rejects.toMatchObject({status: 503, code: 'INTELLIGENCE_RESEARCH_UNAVAILABLE'});
});
