# Das Deny-Backend als eigenes Image statt als Bind-Mount: So haengt nichts
# davon ab, wohin Coolify das Repo auf dem Host auspackt.
FROM nginx:1.27-alpine
COPY infra/traefik/deny-backend/default.conf /etc/nginx/conf.d/default.conf
