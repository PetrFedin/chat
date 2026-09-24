# Образ рабочего пространства.
#
# Развернуть продукт было нечем: инструкция состояла из «поставьте Node,
# поднимите PostgreSQL, накатите миграции руками» — то есть из трёх
# мест, где можно ошибиться, и ни одного, где ошибку заметят.
#
# Сборка в два этапа не ради моды: зависимости ставятся с полным
# набором инструментов, а в готовый образ едет только то, что нужно для
# работы. Клиент PostgreSQL кладём рядом намеренно — резервная копия
# снимается тем же образом, что и работает, и версия pg_dump тогда
# совпадает с сервером сама собой.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# --ignore-scripts: ни один пакет не должен выполнять свой код при
# установке в образ, который потом пойдёт в бой.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-alpine AS runtime
# postgresql-client — для scripts/backup.mjs и scripts/restore.mjs.
# tini — чтобы SIGTERM доходил до Node, а не терялся в PID 1: без него
# перезапуск выглядит как обрыв соединений вместо остановки по правилам.
RUN apk add --no-cache postgresql17-client tini

ENV NODE_ENV=production \
    PORT=3000 \
    UPLOAD_DIR=/data/uploads \
    BACKUP_DIR=/data/backups

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY db ./db
COPY scripts ./scripts

# Пишем не от root: процессу нужны ровно два каталога, и оба ему отдаём.
RUN mkdir -p /data/uploads /data/backups && chown -R node:node /data /app
USER node

EXPOSE 3000
VOLUME ["/data"]

# Готовность, а не живость: контейнер считается рабочим, когда до базы и
# до хранилища действительно можно достучаться.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
