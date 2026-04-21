# Aplicație Nutriție - Production Ready

Aplicație web pentru managementul planurilor de nutriție, dezvoltată cu Next.js 16 și Supabase.

## 🚀 Caracteristici

- **Autentificare securizată** cu JWT și bcrypt
- **Generare planuri alimentare** cu OpenAI GPT-4
- **Sistem de invitații** prin email (Resend)
- **Notificări în timp real** pentru antrenori și clienți
- **Tracking progres** cu istoricul greutății
- **Dashboard interactiv** pentru antrenori și clienți
- **Export PDF** pentru planurile generate
- **Rate limiting** și protecție împotriva abuzurilor

## 📋 Cerințe

- Node.js 18+ sau 20+
- Cont Supabase (free tier funcționează)
- Cheie API OpenAI
- Cheie API Resend (pentru emailuri)

## 🛠️ Instalare

1. **Clonează repository-ul**
   ```bash
   git clone <repository-url>
   cd aplicatienutritie
   ```

2. **Instalează dependințele**
   ```bash
   npm install
   ```

3. **Configurează variabilele de mediu**
   ```bash
   cp .env.example .env.local
   ```
   
   Editează `.env.local` și completează:
   - `NEXT_PUBLIC_SUPABASE_URL` - URL-ul proiectului Supabase
   - `SUPABASE_SERVICE_ROLE_KEY` - Cheia service role din Supabase
   - `JWT_SECRET` - Secret pentru JWT (minim 32 caractere)
   - `OPENAI_API_KEY` - Cheia API OpenAI
   - `RESEND_API_KEY` - Cheia API Resend
   - `NEXT_PUBLIC_APP_URL` - URL-ul aplicației (localhost:3000 pentru dev)

4. **Configurează baza de date**
   
   Rulează scripturile SQL din `supabase/` în ordinea:
   - `activity_logs.sql`
   - `client_invitations.sql`
   - `foods.sql`
   - `weight_history.sql`
   - `add_food_preferences.sql`

5. **Pornește aplicația în development**
   ```bash
   npm run dev
   ```
   
   Aplicația va fi disponibilă la `http://localhost:3000`

## 🏗️ Build pentru producție

```bash
npm run build
npm start
```

## 📁 Structură

```
aplicatienutritie/
├── app/
│   ├── api/              # API routes
│   ├── auth/             # Autentificare
│   ├── components/       # Componente React
│   ├── contexts/         # Context providers
│   ├── dashboard/        # Dashboard antrenor
│   ├── client/           # Dashboard client
│   └── lib/              # Utilități
├── public/               # Fișiere statice
├── supabase/             # Scripturi SQL
└── next.config.mjs       # Configurare Next.js
```

## 🔒 Securitate

- Toate rutele API sunt protejate cu verificare JWT
- Parole hash-uite cu bcrypt (salt rounds: 10)
- Sanitizare input-uri împotriva XSS
- Rate limiting pe generare planuri
- Activity logging pentru audit
- Headers de securitate configurate

## 📦 Tehnologii

- **Framework**: Next.js 16.2.0
- **Database**: Supabase (PostgreSQL)
- **AI**: OpenAI GPT-4
- **Styling**: Tailwind CSS 4
- **Authentication**: JWT + bcrypt
- **Email**: Resend
- **PDF**: jsPDF + jsPDF-AutoTable

## 📝 Licență

Proprietate privată. Toate drepturile rezervate.
