#!/usr/bin/env bash
# One-shot bootstrap for a fresh EC2 box running Ubuntu LTS.
# Usage:  sudo bash setup.sh DOMAIN
# The repo must already be cloned into /opt/tradealert.me.
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]] || [[ "$DOMAIN" == */* ]]; then
  echo "usage: sudo bash setup.sh DOMAIN   (no slashes, e.g. tradealert.me)" >&2
  exit 1
fi
if [ ! -d /opt/tradealert.me/.git ]; then
  echo "clone the tradealert.me repo into /opt/tradealert.me first" >&2
  exit 1
fi
cd /opt/tradealert.me

gen() { head -c 20 /dev/urandom | base64 | tr -d '/+=' | head -c 32; }

if [ ! -f .env ]; then
  echo "== generating .env with fresh secrets =="
  umask 077
  PASSWORD="$(gen)"
  JWT="$(gen)"
  HOOK="$(gen)"
  cat > .env <<EOF
POSTGRES_DB=tradealert
POSTGRES_USER=tradealert
POSTGRES_PASSWORD=${PASSWORD}
DATABASE_URL=postgresql://tradealert:${PASSWORD}@localhost:5432/tradealert
JWT_SECRET=${JWT}
APP_BASE_URL=https://${DOMAIN}
AWS_REGION=
SES_VERIFIED_SENDER=alerts@${DOMAIN}
STRIPE_SECRET_KEY=
STRIPE_PRICE_ID_free=
STRIPE_PRICE_ID_basic=
STRIPE_PRICE_ID_pro=
STRIPE_PRICE_ID_investor=
STRIPE_WEBHOOK_SECRET=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:alerts@${DOMAIN}
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=
WEBHOOK_SECRET_KEY=${HOOK}
BILLING_DEV_MODE=0
EOF
else
  echo "== existing .env left in place =="
  grep -q '^JWT_SECRET=dev-only-jwt-secret-change-me' .env && {
    echo "refusing to run with the placeholder JWT_SECRET; set a real one in /opt/tradealert.me/.env" >&2
    exit 1
  }
  grep -q '^POSTGRES_PASSWORD=dev-only-change-me' .env && {
    echo "refusing to run with the placeholder POSTGRES_PASSWORD; set a real one in /opt/tradealert.me/.env" >&2
    exit 1
  }
fi

echo "== apt =="
sudo apt-get update -qq
sudo apt-get install -y -qq docker.io docker-compose-v2 nginx certbot python3-certbot-nginx

echo "== postgres + app =="
sudo systemctl enable --now docker
docker compose up -d --build

echo "== nginx =="
sed -e "s/DOMAIN/${DOMAIN}/g" deploy/nginx.conf > /tmp/tradealert-nginx.conf
sudo cp /tmp/tradealert-nginx.conf /etc/nginx/sites-available/tradealert.me
sudo ln -sf /etc/nginx/sites-available/tradealert.me /etc/nginx/sites-enabled/tradealert.me
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t

echo "== TLS (certbot) =="
sudo certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos \
  -m "admin@${DOMAIN}" --redirect

echo "== cron + log rotation =="
sudo cp deploy/crontab /etc/crontab
sudo cp deploy/logrotate /etc/logrotate.d/tradealert

echo
echo "Done. Remaining manual steps:"
echo "  1. Verify alerts@${DOMAIN} in SES; set AWS_REGION and SES_VERIFIED_SENDER in /opt/tradealert.me/.env, then:  docker compose restart app"
echo "  2. To take payments: set the STRIPE_* keys in .env, point Stripe webhooks at https://${DOMAIN}/api/billing/webhook, restart app."
echo "  3. Optional push/SMS: generate a VAPID keypair (web-push generate-vapid-keys) and set the VAPID_* and TWILIO_* keys in .env."
echo "  4. Point the domain's DNS at this box and make sure the EC2 security group allows 80 and 443 from 0.0.0.0/0."
echo "  5. Check:  curl -I https://${DOMAIN}/api/docs"