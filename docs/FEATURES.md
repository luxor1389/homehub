# Šta je urađeno i šta nije

Status: radna verzija spremna za probu na pravom Supabase projektu. Nije proglašena gotovom ni bezbednom
dok se ne prođu ručne provere iz docs/TESTING.md („Šta NIJE testirano“).

## Urađeno

**Nalozi i domaćinstva**
- Registracija, prijava, odjava, zaboravljena lozinka, promena lozinke, ime i jezik po korisniku.
- Više domaćinstava po korisniku i prebacivanje između njih.
- Pozivnice: link sa rokom važenja i brojem korišćenja, opciono vezan za email; deljenje (Web Share),
  kopiranje ili otvaranje email aplikacije sa pripremljenom porukom; spisak i opoziv. U bazi se čuva samo heš.
- Svi članovi imaju ista prava nad podacima. Administrator dodatno: podaci domaćinstva, članovi, pozivnice.
  Kontrolisana predaja administracije; poslednji administrator ne može da ode.
- Uklanjanje i napuštanje: otvorena zaduženja postaju nedodeljena, istorija ostaje.

**Zadaci**
- Brzo dodavanje („+ Novi zadatak“) sa svake stranice, na telefonu plutajuće dugme.
- Kategorije, prioriteti, procena vremena, prostorija/automobil/ljubimac/biljka, koraci (checklist).
- Ponavljanje: dnevno, nedeljno (izabrani dani), mesečno, godišnje, svakih N, do datuma.
- Automatsko „Zakasnelo“, ko je i kada završio, ponovno otvaranje uz čuvanje istorije.
- Izmena „samo ovo ponavljanje“ ili „ovo i sva buduća“; arhiviranje i trajno brisanje arhiviranog.
- Isključivo ručna dodela; pregled opterećenja po članu (broj zadataka i minuti, 7/30 dana).
- Komentari, dogovori (novi rok jednim klikom) i zamene (primena jednim klikom).
- Početna strana: zakasnelo, danas, narednih 7 dana, u toku, nedavno završeno, kupovina, obroci, računi,
  automobili, ljubimci i biljke, sa filterima.

**Moduli**
- Čišćenje: zadaci po prostorijama, gotovi predlozi, sopstveni šabloni, dodavanje prostorija.
- Kupovina: više spiskova, kategorije, sprečavanje duplikata (nudi uvećanje), ručno spajanje, istorija ko je
  kupio i kada (sa cenom), „kupi ponovo“, ostava sa minimalnim količinama.
- Obroci: nedeljni plan, recepti sa sastojcima, ko kuva, priprema unapred; sastojci se na spisak prebacuju
  tek posle pregleda (dodaj / uvećaj postojeće / preskoči), nikad automatski.
- Računi i troškovi: ponavljajući računi, evidencija plaćanja (ko, kada, iznos), sledeći račun se pravi
  jednom; troškovi; pregled po kategorijama, članovima, planirano naspram potrošenog, po valuti.
  Novac je `NUMERIC`, podrazumevano RSD. Nema povezivanja sa bankom ni plaćanja.
- Automobili: registracija, osiguranje, tehnički, servis po datumu i kilometraži, gume, dnevnik troškova,
  prosečna potrošnja goriva, podsetnici.
- Ljubimci: nega, ishrana, vakcinacije i veterinar kao evidencija sa „sledeći put“, bez medicinskih saveta.
- Biljke: zalivanje i prihrana po intervalu, „Zaliveno“ jednim klikom, istorija nege, ponavljajući zadatak.
- Prilozi i fotografije (privatni Storage, samo članovi domaćinstva).
- Kalendar: dan, nedelja, mesec; zadaci, računi, obroci, automobili, ljubimci, biljke; filter po članu.
- Obaveštenja u aplikaciji: dodela, promena roka, rok uskoro, zakasnelo, računi, automobili, ljubimci,
  biljke, novi član. Brojač nepročitanih, „označi sve“.
- Istorija aktivnosti (ko je šta promenio), automatski iz baze.
- Srpski (latinica) i engleski, svi tekstovi kroz prevode; vremenska zona domaćinstva (Europe/Belgrade).
- PWA: instalacija na telefon/računar, ikonice, ponuda za osvežavanje nove verzije.
- Bez interneta: aplikacija se otvara, ali jasno javlja da izmene ne mogu da se sačuvaju; ništa se ne
  prikazuje kao sačuvano ako server to nije potvrdio.

## Ograničenja

- **Email obaveštenja se ne šalju.** Baza pravi red za slanje (`notification_deliveries`) za korisnike koji
  su ih uključili, ali servis koji šalje (npr. Supabase Edge Function + Resend) nije napravljen. U aplikaciji
  piše „Email: čeka slanje“ — ne tvrdi da je poslato.
- **Push obaveštenja nisu implementirana.**
- **Email pozivnice** šalje korisnik iz svoje email aplikacije; server ih ne šalje.
- **Rad bez interneta** je samo za čitanje već otvorenog ekrana; nema čuvanja izmena za kasnije slanje.
- **Realtime i Storage** nisu testirani automatski (vidi docs/TESTING.md); Realtime ima rezervno osvežavanje.
- Ostava se ne umanjuje automatski posle kuvanja.
- Nema konverzije valuta; zbirovi su po valuti.
- Nema slike profila, promene email adrese ni brisanja naloga iz aplikacije (brisanje radi administrator
  Supabase projekta).
- Native (App Store / Play) aplikacije nisu napravljene. Logika je u bazi i u TypeScript modulima
  (`src/features/*/api.ts`), pa se može ponovo koristiti iz React Native ili Capacitor aplikacije.
- Nije rađen nezavisni bezbednosni pregled ni test opterećenja.
