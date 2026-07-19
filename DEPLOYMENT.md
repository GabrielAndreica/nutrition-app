# Production Deployment Checklist

## ✅ Pre-Deployment

### 1. Environment Variables
- [ ] `.env.local` este configurat cu toate variabilele necesare
- [ ] `JWT_SECRET` are minim 32 caractere și este sigur
- [ ] `SUPABASE_SERVICE_ROLE_KEY` este corect
- [ ] `OPENAI_API_KEY` este valid și are credit
- [ ] `RESEND_API_KEY` este valid pentru trimitere emailuri
- [ ] `NEXT_PUBLIC_APP_URL` este setat la URL-ul de producție
- [ ] Pentru ads: `NEXT_PUBLIC_MARKETING_PIXELS_ENABLED=true` și `NEXT_PUBLIC_TIKTOK_PIXEL_ID` este Pixel ID-ul din TikTok Events Manager
- [ ] Dacă folosești și Meta Ads: `NEXT_PUBLIC_META_PIXEL_ID` este completat

### 2. Database Setup
- [ ] Toate scripturile SQL din `supabase/` au fost rulate
- [ ] Tabele create: users, clients, meal_plans, notifications, client_invitations, weight_history, activity_logs, foods
- [ ] RPC functions create: check_rate_limit
- [ ] Indexuri optimizate pentru performanță
- [ ] Row Level Security (RLS) configurat dacă se folosește

### 3. Code Quality
- [ ] `npm run build` rulează fără erori
- [ ] Nu există console.log în cod (removeConsole din next.config.mjs se ocupă de asta)
- [ ] Toate secretele sunt în variabile de mediu, nu hardcodate
- [ ] ESLint rulează fără erori: `npm run lint`

### 4. Security
- [ ] JWT_SECRET diferit de cel de development
- [ ] Rate limiting testat și funcțional
- [ ] CORS configurat corect în next.config.mjs
- [ ] Headers de securitate verificate
- [ ] Activity logging funcțional

### 5. Performance
- [ ] Cache-ul pentru alimente funcționează (5 minute TTL)
- [ ] Imagini optimizate (AVIF/WebP)
- [ ] Compression activat în next.config.mjs
- [ ] Bundle size verificat: `npm run build`

## 🚀 Deployment

### Opțiuni de Deployment

#### A. Vercel (Recomandat pentru Next.js)
```bash
# 1. Instalează Vercel CLI
npm i -g vercel

# 2. Login
vercel login

# 3. Deploy
vercel --prod
```

**Configurare Vercel:**
- Adaugă toate variabilele de mediu în Vercel Dashboard
- Setează `NODE_VERSION` la 20.x
- Build command: `npm run build`
- Output directory: `.next`

#### B. Docker
```bash
# 1. Build
docker build -t aplicatie-nutritie .

# 2. Run
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  -e JWT_SECRET=... \
  -e OPENAI_API_KEY=... \
  -e RESEND_API_KEY=... \
  -e NEXT_PUBLIC_APP_URL=... \
  aplicatie-nutritie
```

#### C. Hetzner VPS (Ubuntu/Debian + Docker + Nginx)

Aceasta este varianta recomandată pentru VPS: aplicația rulează în Docker pe `127.0.0.1:3000`, iar nginx termină HTTPS-ul public.

```bash
# 1. Instalează Docker
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 2. Clonează aplicația
git clone <repo-url>
cd aplicatienutritie

# 3. Configurează env-ul de producție
cp .env.example .env.production
nano .env.production

# 4. Verifică env-ul înainte de build
docker run --rm -v "$PWD":/app -w /app node:20-bookworm-slim node scripts/check-production-env.mjs .env.production

# 5. Build + start
docker compose --env-file .env.production up -d --build

# 6. Verifică healthcheck local
curl http://127.0.0.1:3000/api/health
```

Nginx:

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo cp deploy/nginx/trevano.conf.example /etc/nginx/sites-available/trevano
sudo nano /etc/nginx/sites-available/trevano
sudo ln -s /etc/nginx/sites-available/trevano /etc/nginx/sites-enabled/trevano
sudo nginx -t
sudo certbot --nginx -d trevano.app -d www.trevano.app
sudo systemctl reload nginx
```

Update deploy:

```bash
git pull
docker compose --env-file .env.production up -d --build
docker image prune -f
```

Loguri:

```bash
docker compose logs -f trevano
```

Notă: `docker compose config` este util pentru debugging, dar poate afișa variabilele de mediu. Nu publica output-ul acestei comenzi.

În Supabase rulează și `scripts/add-activity-logs-production-hardening.sql` ca să ai tabela `activity_logs`, indexurile și RLS-ul pregătite.

#### D. VPS clasic (Ubuntu/Debian + PM2)
```bash
# 1. Instalează Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Clone repository
git clone <repo-url>
cd aplicatienutritie

# 3. Instalează dependințe
npm install

# 4. Configurează .env.local
cp .env.example .env.local
nano .env.local

# 5. Build
npm run build

# 6. Start cu PM2
npm install -g pm2
pm2 start npm --name "aplicatie-nutritie" -- start
pm2 startup
pm2 save
```

## ✅ Post-Deployment

### 1. Smoke Testing
- [ ] Pagina de autentificare se încarcă
- [ ] Login funcționează cu cont de test
- [ ] Dashboard antrenor se încarcă
- [ ] Dashboard client se încarcă
- [ ] Generare plan alimentar funcționează
- [ ] Notificări funcționează
- [ ] Export PDF funcționează
- [ ] Invitații email se trimit
- [ ] Bannerul de cookies permite "Doar necesare" și "Acceptă toate"
- [ ] TikTok Pixel apare în TikTok Pixel Helper doar după acceptarea cookie-urilor de marketing
- [ ] Test Events din TikTok Events Manager primește PageView pe paginile publice

### 2. Monitoring
- [ ] Setup monitoring (Vercel Analytics / Sentry)
- [ ] Verifică logs pentru erori
- [ ] Monitorizează API response times
- [ ] Verifică rate limiting funcționează

### 3. Performance
- [ ] Lighthouse score > 90
- [ ] First Contentful Paint < 1.5s
- [ ] Time to Interactive < 3.5s
- [ ] Cumulative Layout Shift < 0.1

### 4. Security Final Check
- [ ] HTTPS activat și funcțional
- [ ] Security headers verificate cu securityheaders.com
- [ ] Nu există expunere de secret keys în client
- [ ] Rate limiting testat cu mai multe request-uri

## 📊 Monitorizare Continuă

### Metrici de monitorizat:
- Response time API (target: < 500ms)
- Error rate (target: < 0.1%)
- OpenAI API usage și costuri
- Database query performance
- Rate limit hits

### Backup
- [ ] Backup automat database Supabase configurat
- [ ] Backup manual înaintea schimbărilor majore

## 🔧 Troubleshooting

### Probleme comune:

**"Invalid JWT token"**
- Verifică JWT_SECRET este același în toate instanțele
- Verifică expirarea token-urilor (24h default)

**"OpenAI rate limit exceeded"**
- Verifică tier-ul contului OpenAI
- Implementează queue sau reduce concurrent requests

**"Supabase connection error"**
- Verifică SUPABASE_SERVICE_ROLE_KEY
- Verifică IP whitelisting în Supabase dashboard

**"Email not sending"**
- Verifică RESEND_API_KEY
- Verifică domeniul este verificat în Resend

## 📝 Notes

- **Database migrations**: Rulează manual până implementezi Prisma/Drizzle
- **Logs**: Verifică în Vercel Dashboard sau prin `pm2 logs`
- **Updates**: `git pull && npm install && npm run build && pm2 restart all`

---
**Data ultimei actualizări**: Aprilie 2026
**Versiune**: 1.0.0
