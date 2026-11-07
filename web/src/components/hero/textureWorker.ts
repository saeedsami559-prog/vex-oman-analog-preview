import { earthTexture, marsTexture, type PlanetTexture } from './planetTextures';

// Typed loosely so this file compiles under the app's DOM lib without pulling in the WebWorker lib.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<'earth' | 'mars'>) => void) | null;
  postMessage: (msg: unknown, transfer: Transferable[]) => void;
};

function send(tex: PlanetTexture) {
  const transfer: Transferable[] = [tex.color.buffer];
  if (tex.clouds) transfer.push(tex.clouds.buffer);
  if (tex.lights) transfer.push(tex.lights.buffer);
  ctx.postMessage(tex, transfer);
}

// Progressive: a small texture first so the planet appears almost at once, then the sharp one.
ctx.onmessage = (e) => {
  const make = e.data === 'earth' ? earthTexture : marsTexture;
  send(make(384, 192));
  send(e.data === 'earth' ? make(1536, 768) : make(1024, 512));
};
