// smap CLI. Usage: npm run view|check -- <map.json | repo dir>
//   view   opens the viewer on the map and reloads it when the file changes
//   check  validates the map; exits 1 on errors
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Plugin } from "vite";
import { validate } from "@smap/ir";

const [command, arg = "."] = process.argv.slice(2);
// Relative to where the command was run: npm sets INIT_CWD, even with --prefix.
const target = resolve(process.env.INIT_CWD ?? process.cwd(), arg);
const file = existsSync(target) && statSync(target).isDirectory() ? join(target, ".smap", "map.json") : target;

if (command === "check") check();
else if (command === "view") await view();
else {
  console.error("usage: smap view|check <map.json | repo dir>");
  process.exit(2);
}

function check() {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`${file}: ${(e as Error).message}`);
    process.exit(1);
  }
  const { errors, warnings } = validate(doc);
  for (const w of warnings) console.warn(`warning: ${w}`);
  for (const e of errors) console.error(`error: ${e}`);
  console.log(errors.length ? `${file}: ${errors.length} error(s)` : `${file}: ok`);
  process.exit(errors.length ? 1 : 0);
}

async function view() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "render");
  const server = await createServer({ root, configFile: false, plugins: [serveMap()], server: { port: 5419, open: true } });
  await server.listen();
  console.log(`Viewing ${file}`);
  server.printUrls();
}

/** Serves the map at /@smap/map.json and reloads the page when it changes. */
function serveMap(): Plugin {
  return {
    name: "smap-map-file",
    configureServer(server) {
      server.middlewares.use("/@smap/map.json", (_req, res) => {
        res.setHeader("x-smap-path", encodeURIComponent(file));
        try {
          res.setHeader("content-type", "application/json");
          res.end(readFileSync(file));
        } catch (e) {
          res.statusCode = 500;
          res.end(`can't read ${file}: ${(e as Error).message}`);
        }
      });
      server.watcher.add(file);
      server.watcher.on("all", (_event, path) => {
        if (path === file) server.ws.send({ type: "full-reload" });
      });
    },
  };
}
