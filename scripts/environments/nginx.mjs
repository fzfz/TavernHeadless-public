import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

function quote(value) {
  return `"${String(value).replace(/[\\"$]/g, "\\$&")}"`;
}

function publicFile(env, frontend, filename) {
  return `    location = /config/${filename} {
      alias ${quote(join(env.paths.publicConfig, frontend, filename))};
      default_type application/json;
      add_header Cache-Control "no-store" always;
    }`;
}

export function generateNginxConfig(env) {
  const upstream = `http://${env.listenHost}:${env.ports.api}`;
  const serverNames = [...new Set([env.hostname, ...env.hostAliases])].join(
    " ",
  );
  const servers = env.frontends.map((frontend) => {
    const ports = env.ports.frontends[frontend];
    const page =
      env.mode === "development"
        ? `    location / {
      proxy_intercept_errors on;
      error_page 404 = @frontend_page;
      proxy_pass http://${env.listenHost}:${ports.dev};
    }
    location @frontend_page {
      if ($request_method !~ ^(GET|HEAD)$) { return 404; }
      if ($http_accept !~* "(^$|text/html|[*]/[*])") { return 404; }
      rewrite ^ /index.html last;
    }
    location ~* ^/assets/|\\.[^/]+$ {
      proxy_pass http://${env.listenHost}:${ports.dev};
    }`
        : `    root ${quote(join(env.paths.current, frontend))};
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    location ^~ /assets/ { try_files $uri =404; }
    location ~* \\.[^/]+$ { try_files $uri =404; }`;
    return `  server {
    listen ${env.gatewayListenHost}:${ports.http} default_server;
    server_name _;
    return 444;
  }
  server {
    listen ${env.gatewayListenHost}:${ports.http};
    server_name ${serverNames};
    location = /healthz { return 204; }
    location ^~ /api/ {
      proxy_pass ${upstream}/;
    }
    location = /ws {
      proxy_pass ${upstream};
    }
${env.publicFiles[frontend].map((filename) => publicFile(env, frontend, filename)).join("\n")}
    location ^~ /config/ { return 404; }
${page}
  }`;
  });
  return `daemon off;
master_process on;
pid ${quote(join(env.paths.run, "nginx.pid"))};
error_log ${quote(join(env.paths.processLogs, "nginx-error.log"))};
events {}
http {
  access_log off;
  default_type application/octet-stream;
  types {
    text/html html;
    text/css css;
    text/javascript js mjs;
    application/json json map;
    application/wasm wasm;
    image/png png;
    image/jpeg jpg jpeg;
    image/svg+xml svg;
    image/webp webp;
    image/x-icon ico;
    font/woff woff;
    font/woff2 woff2;
  }
  client_body_temp_path ${quote(join(env.paths.run, "nginx/client-body"))};
  proxy_temp_path ${quote(join(env.paths.run, "nginx/proxy"))};
  fastcgi_temp_path ${quote(join(env.paths.run, "nginx/fastcgi"))};
  uwsgi_temp_path ${quote(join(env.paths.run, "nginx/uwsgi"))};
  scgi_temp_path ${quote(join(env.paths.run, "nginx/scgi"))};
  client_max_body_size ${env.uploadMaxBytes};
  map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
  }
  proxy_http_version 1.1;
  proxy_buffering off;
  proxy_request_buffering off;
  proxy_cache off;
  proxy_read_timeout ${env.timeouts.proxySeconds}s;
  proxy_send_timeout ${env.timeouts.proxySeconds}s;
  proxy_set_header Host $http_host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
${servers.join("\n")}
}
`;
}

export async function writeNginxConfig(env) {
  await mkdir(dirname(env.paths.nginxConfig), { recursive: true });
  await mkdir(env.paths.processLogs, { recursive: true });
  for (const directory of [
    "client-body",
    "proxy",
    "fastcgi",
    "uwsgi",
    "scgi",
  ]) {
    await mkdir(join(env.paths.run, "nginx", directory), { recursive: true });
  }
  const temporary = `${env.paths.nginxConfig}.${randomUUID()}.tmp`;
  await writeFile(temporary, generateNginxConfig(env), { mode: 0o600 });
  await rename(temporary, env.paths.nginxConfig);
  return { path: env.paths.nginxConfig, prefix: `${env.paths.run}/` };
}
