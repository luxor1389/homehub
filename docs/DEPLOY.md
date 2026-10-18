# Produkcija

Aplikacija je statički sajt (folder `dist/`) + Supabase. Nema sopstvenog servera.

## Build

```bash
npm ci
VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npm run build
```

## Hosting

Bilo koji statički hosting sa HTTPS-om (PWA i service worker rade samo preko HTTPS-a). Bitno je da sve
nepoznate putanje vraćaju `index.html` (SPA rutiranje, npr. `/join/<token>`).

**Railway** (podešeno u `railway.json`): New Project → Deploy from GitHub repo → izaberi repozitorijum.
U **Variables** dodaj `VITE_SUPABASE_URL` i `VITE_SUPABASE_ANON_KEY` (Railway ih prosleđuje i u build).
Railway pokreće `npm run build`, pa `npm start` (statički server sa SPA fallback-om na `$PORT`).
Zatim **Settings → Networking → Generate Domain** daje HTTPS adresu. Supabase i dalje ostaje backend.

**Vercel**: Import repozitorijuma → Framework „Vite“ → Environment Variables: `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`. `vercel.json` je već u repozitorijumu:
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

**Netlify**: Build command `npm run build`, publish `dist`, iste env promenljive, (`public/_redirects` je već u repozitorijumu):
```
/*  /index.html  200
```

**Cloudflare Pages**: Build `npm run build`, output `dist`; SPA fallback radi automatski.

## Posle prvog deploy-a

1. U Supabase-u postavi Site URL i Redirect URLs na produkcionu adresu (docs/SUPABASE.md, korak 3).
2. Podesi SMTP za emailove naloga.
3. Uključi `pg_cron` ako želiš podsetnike i kada niko ne otvara aplikaciju.
4. Uradi ručnu proveru iz docs/SUPABASE.md, korak 5, na produkcionoj adresi.
5. Na telefonu otvori sajt → „Dodaj na početni ekran“ (iOS: Share → Add to Home Screen).

## Nova verzija

Nove migracije: `supabase db push`. Frontend: novi build; korisnicima PWA aplikacija prikaže
„Dostupna je nova verzija“ sa dugmetom za osvežavanje.

## Rezervne kopije

Supabase Pro plan ima dnevne backup-e. Na besplatnom planu povremeno napravi dump:
`supabase db dump -f backup.sql --data-only`.
