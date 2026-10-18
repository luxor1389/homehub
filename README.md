# HomeHub

Aplikacija za zajedničko vođenje domaćinstva: zadaci i ponavljajući poslovi, čišćenje po prostorijama,
kupovina, obroci, računi i troškovi, automobili, ljubimci, biljke, kalendar i obaveštenja.
Radi u pregledaču na računaru i telefonu i može da se instalira kao PWA.

- Frontend: React 18, TypeScript, Vite, Tailwind, React Router, React Hook Form + Zod, TanStack Query, i18next, vite-plugin-pwa
- Backend: Supabase (Auth, Postgres sa RLS, Realtime, Storage). Sva pravila pristupa su u bazi, ne samo u interfejsu.
- Jezici: srpski (latinica, podrazumevano) i engleski. Jezik se čuva po korisniku.

## Dokumentacija

| Dokument | Sadržaj |
|---|---|
| [docs/SUPABASE.md](docs/SUPABASE.md) | Povezivanje sa Supabase projektom, migracije, podešavanje Auth-a |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Objavljivanje u produkciji (Vercel / Netlify / Cloudflare Pages) |
| [docs/FEATURES.md](docs/FEATURES.md) | Šta je urađeno i poznata ograničenja |
| [docs/TESTING.md](docs/TESTING.md) | Testovi baze i E2E testovi, šta je provereno a šta nije |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Model podataka i bezbednosni model |

## Lokalno pokretanje

Potrebno: Node 20+ i Supabase projekat (hostovan ili lokalni preko `supabase start`, vidi docs/SUPABASE.md).

```bash
npm install
cp .env.example .env.local      # upiši URL projekta i JAVNI anon ključ
npm run dev                     # http://localhost:5173
```

U `.env.local` idu **samo** `VITE_SUPABASE_URL` i `VITE_SUPABASE_ANON_KEY`. Service role ključ se nikada ne stavlja
u frontend niti u bilo koju `VITE_` promenljivu — sve sa tim prefiksom završava u pregledaču.

Ostale komande:

```bash
npm run build        # provera tipova + produkcioni build u dist/
npm run preview      # lokalni pregled builda (http://localhost:4173)
npm run i18n:check   # da li svi ključevi postoje u oba jezika
npm run test:db      # integracioni testovi baze (samo na test bazi!)
npm run test:e2e     # E2E testovi u pregledaču (samo na test bazi!)
```

## Struktura

```
supabase/migrations/   SQL migracije: tabele, RLS, funkcije, triggeri, storage
src/                   aplikacija (pages/, features/, components/, household/, auth/, i18n/)
tests/integration/     testovi baze preko pravog Supabase API-ja (RLS, RPC)
e2e/                   Playwright testovi (desktop + mobilni)
scripts/               provera prevoda, ikonice, lokalni test stack
```
