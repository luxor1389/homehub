# Testiranje

> Testovi prave korisnike i podatke. Pokreći ih **samo na test bazi** (lokalni `supabase start` ili zaseban
> test projekat), nikada na produkciji.

## Šta je pokrenuto i prošlo (18. 10. 2026.)

| Paket | Rezultat | Gde |
|---|---|---|
| Integracioni testovi baze (RLS, RPC, triggeri) | **47 / 47** | `tests/integration/` |
| E2E u pregledaču, desktop (Chromium) | **9 / 9** | `e2e/flows.spec.ts` |
| E2E u pregledaču, mobilni (Pixel 7 emulacija) | **1 / 1** | `e2e/mobile.spec.ts` |
| Provera tipova (`tsc`) i produkcioni build | prolazi | `npm run build` |
| Provera prevoda (sr ↔ en, svi ključevi iz koda) | prolazi | `npm run i18n:check` |

**Testovi baze** pokrivaju: dva domaćinstva i izolaciju podataka (čitanje, upis, izmena, brisanje, veze između
domaćinstava), anonimni pristup, admin funkcije naspram jednakih prava članova, poslednjeg admina i predaju
uloge, uklanjanje člana (gubi pristup odmah, zaduženja se oslobađaju), pozivnice (jednokratne, istekle,
opozvane, za drugi email, čuva se samo heš), ponavljajuće zadatke (dnevno, nedeljno po danima, svakih N
nedelja, 31. u mesecu, godišnje, bez duplikata pri istovremenom generisanju), automatsko „zakasnelo“, ko je i
kada završio, ponovno otvaranje uz istoriju, izmenu „samo ovo“ / „sva buduća“, arhiviranje, komentare,
dogovore i zamene, kupovinu (duplikati, spajanje, istorija, sastojci iz recepata), račune (NUMERIC iznosi,
plaćanje samo kroz RPC, sledeći račun tačno jednom), podsetnike, obaveštenja (samo svoja, samo za čitanje)
i Storage putanje drugih domaćinstava.

**E2E testovi** (3 korisnika u istom domaćinstvu + 1 spoljni): registracija kroz UI, novo domaćinstvo,
link pozivnice sa 2 korišćenja i odbijanje trećeg, brzo dodavanje zadatka i dodela, obaveštenje kod
dodeljenog člana, završavanje i prikaz ko je završio, duplikat na spisku i spajanje, rad bez interneta (jasna
greška, ništa se lažno ne prikazuje kao sačuvano), spoljni korisnik ne vidi tuđi zadatak ni spisak, jezik po
korisniku (i posle prijave na drugom uređaju), uklanjanje člana, običan član ne može da menja podešavanja
domaćinstva ni da pravi pozivnice (ni zaobilaženjem UI-ja). Mobilni test: donja navigacija, dugme „+“, meni
„Više“ i da nijedna glavna stranica nema horizontalno skrolovanje na širini telefona.

## Šta NIJE testirano

- **Realtime preko websocket-a.** Test okruženje nije imalo Realtime server; E2E testovi su prošli preko
  rezervnog osvežavanja (polling). Trenutno ažuriranje treba ručno proveriti na pravom Supabase projektu
  (docs/SUPABASE.md, korak 5).
- **Storage (otpremanje fotografija i priloga).** Nije bilo Storage servera. Provereno je samo da baza odbija
  putanje drugog domaćinstva; samo otpremanje, prikaz i brisanje fajlova treba ručno proveriti.
- **Hostovani Supabase.** Migracije su testirane na Postgres 16 sa GoTrue i PostgREST serverima i SQL
  „shim“-om koji oponaša Supabase uloge, ne na samom supabase.com projektu.
- **Slanje emaila i push obaveštenja** — nisu implementirani (vidi docs/FEATURES.md).
- Safari / iOS i Firefox — testovi su rađeni u Chromium-u.

## Pokretanje

```bash
# 1) test baza
supabase start && supabase db reset
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_ANON_KEY=<anon iz supabase status>
export SUPABASE_SERVICE_ROLE_KEY=<service_role iz supabase status>   # samo u terminalu, za pravljenje test korisnika

# 2) testovi baze
npm run test:db

# 3) E2E (sam napravi build sa test URL-om i anon ključem i pokrene preview)
npx playwright install chromium     # prvi put
npm run test:e2e
```

Bez Dockera: `scripts/local-stack/` sadrži skripte kojima je ovaj projekat testiran (Postgres + GoTrue +
PostgREST + mali gateway); `reset-db.sh` primenjuje migracije, `test-env.sh` postavlja promenljive.
