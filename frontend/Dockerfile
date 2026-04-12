FROM node:18 AS build

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

ARG REACT_APP_API_URL=/api
ENV REACT_APP_API_URL=$REACT_APP_API_URL

RUN npm run build

FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY 30-headlamp-token.sh /docker-entrypoint.d/30-headlamp-token.sh
RUN chmod +x /docker-entrypoint.d/30-headlamp-token.sh
EXPOSE 80
