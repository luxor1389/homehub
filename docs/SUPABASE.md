# Povezivanje sa Supabase-om

## 1. Projekat

1. Napravi projekat na https://supabase.com (region npr. Frankfurt, `eu-central-1`).
2. **Database → Extensions**: uključi `pg_cron` (opciono, za podsetnike svakog sata; bez njega se podsetnici
   osvežavaju kada neko otvori aplikaciju). `pgcrypto` je već uključen.

## 2. Migracije

Preko Supabase CLI (preporučeno, migracije su verzionisane u `supabase/migrations/`):

```bash
npm i -g supabase            # ili: npx supabase ...
supabase login
supabase init                # samo prvi put; postojeće migracije ostaju
supabase link --project-ref <REF-PROJEKTA>
supabase db push             # primenjuje sve migracije redom
```

Bez CLI-ja: otvori **SQL Editor** i izvrši fajlove iz `supabase/migrations/` redom po imenu (0001 → 0006).

Migracije prave: tabele sa RLS politikama, pomoćne funkcije u šemi `private`, RPC funkcije (pozivnice, zadaci,
kupovina, računi), privatni Storage bucket `household-files` sa politikama, tabele za obaveštenja i istoriju,
dodaju tabele u `supabase_realtime` publikaciju i (ako postoji `pg_cron`) zakazuju osvežavanje podsetnika.

## 3. Auth podešavanja

**Authentication → URL Configuration**
- Site URL: adresa aplikacije, npr. `https://homehub.example.com`
- Redirect URLs: `https://homehub.example.com/**` (i `http://localhost:5173/**` za razvoj)

**Authentication → Providers → Email**
- Uključi „Confirm email“ (preporučeno). Aplikacija tada posle registracije traži potvrdu emaila.
- Minimalna dužina lozinke: 8 (aplikacija to već proverava).

**Authentication → SMTP**: ugrađeni Supabase mailer je ograničen na mali broj poruka na sat i služi samo za
probu. Za produkciju podesi sopstveni SMTP (npr. Resend, Postmark, Mailgun) — inače potvrde naloga i reset
lozinke neće stizati pouzdano.

## 4. Ključevi u aplikaciji

**Project Settings → API**:
- `Project URL` → `VITE_SUPABASE_URL`
- `anon` / `publishable` ključ → `VITE_SUPABASE_ANON_KEY`

`service_role` ključ **ne ide u aplikaciju**. Aplikaciji nije potreban. Koristi ga samo za testove na
zasebnom test projektu, u terminalu, nikad u `.env.local` frontenda.

## 5. Provera

1. `npm run dev`, registruj nalog, napravi domaćinstvo.
2. U drugom pregledaču (ili privatnom prozoru) registruj drugi nalog i otvori link pozivnice.
3. Dodaj stavku na spisak u jednom prozoru — u drugom treba da se pojavi odmah (Realtime). Ako se pojavi tek
   posle ~30 s, Realtime nije aktivan i aplikacija koristi rezervno osvežavanje; proveri **Database →
   Publications → supabase_realtime**.

## Lokalni Supabase (Docker)

```bash
supabase start               # prvi put preuzima Docker image-e
supabase db reset            # primenjuje migracije na lokalnu bazu
supabase status              # ispisuje lokalni URL, anon i service_role ključ
```

Za testove: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` iz `supabase status`
(vidi docs/TESTING.md). Testovi prave korisnike — nikada ih ne pokreći na produkcionoj bazi.
