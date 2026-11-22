FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
RUN mkdir -p /app/var && chown node:node /app/var
COPY --chown=node:node package.json ./
COPY --chown=node:node bin/ ./bin/
COPY --chown=node:node src/ ./src/
COPY --chown=node:node public/ ./public/
USER node
VOLUME ["/app/var"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "bin/server.mjs"]
