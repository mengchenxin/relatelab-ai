FROM node:24-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/evals ./evals
COPY --from=build /app/tsconfig.json ./

EXPOSE 8787
CMD ["npm", "start"]
