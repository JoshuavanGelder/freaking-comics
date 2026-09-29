# Freaking Comics

Houd bij welke comics je gelezen hebt. Per serie een bladwijzer, altijd zichtbaar welk deel het volgende is, en een pop-art jasje. Gegevens en covers komen automatisch van [Metron](https://metron.cloud) of [Comic Vine](https://comicvine.gamespot.com), je kast synct tussen je apparaten, en elke ochtend kijkt de server of er nieuwe delen zijn.

## Wat de app kan

- **Alles via de API's**: de app start leeg en bevat geen voorbeelddata. Je zoekt in één keer op Metron én Comic Vine, bekijkt eerst wat er in een reeks zit, en kiest bij het toevoegen tot welk deel je gelezen hebt. Metron is sterk in losse nummers en nieuwe uitgaven; Comic Vine heeft ook oudere trades (zoals The Flash New 52).
- **Bestaande series en losse boeken koppelen**, ook meerdere reeksen per serie (bijv. Ultimates, X-Men en Spider-Man in "Ultimate Comics"). Je leesstatus, bezit en gelezen issues blijven altijd van jou; ontkoppelen kan per reeks.
- **Bladwijzer per serie**: "Verder lezen" op Home, laatst gelezen bovenaan, met één tik op *Uit!* naar het volgende deel.
- **Het verhaal gaat verder**: bij elk boek zie je wat er vóór en na komt, per serie die erin zit (bijv. bij Divided We Fall: Ultimates en X-Men #1–12 eerder, vanaf #19 daarna), live van Metron. Staat het al in je kast, dan zie je dat; anders zoek je met één tik de trade.
- **Aanraders**: geef boeken die je gelezen hebt een duim (*Top* of *Niks*). Claude kijkt in je kast en raadt boeken aan met een reden erbij: vervolgen, meer van dezelfde schrijver of tekenaar, en boeken in dezelfde sfeer. Covers en de reeks komen van Comic Vine, zodat je met één tik bekijkt en toevoegt. Met *Niks voor mij* klik je een aanrader weg; die komt niet meer terug.
- **Volgorde en zijverhalen** per serie: hoofdverhaal, zijverhalen en events op verschijningsdatum, met *Alleen hoofdverhaal* en *+ Toch lezen*.
- **Nieuwe delen automatisch**: elke ochtend om ±07:00 controleert de server al je gekoppelde reeksen. Nieuwe delen verschijnen op Home onder *Nieuw verschenen*; aangekondigde delen onder *Binnenkort*. Het aantal nieuwe delen staat ook als getal op het app-icoon (waar je telefoon dat ondersteunt).
- **Sync tussen apparaten**: automatisch bij openen, na elke wijziging en elke 5 minuten. Werkt ook offline. **Alles wissen** leegt de kast op de server én op al je gekoppelde apparaten.
- Leesstatus en kaststatus, issues afvinken, pauze, verlanglijst, ongedaan maken, back-up.

## Installeren (eenmalig, ± 10 minuten)

De app draait op [Vercel](https://vercel.com) (gratis): daar staan de app, de koppeling met Metron, de opslag en de dagelijkse controle.

1. **Metron-token**: maak een account op [metron.cloud](https://metron.cloud/accounts/signup/) en maak een token aan onder [API Tokens](https://metron.cloud/accounts/tokens/).
2. **Project importeren**: log in op Vercel met GitHub → *Add New… → Project* → kies `freaking-comics` → *Deploy*. Laat alle instellingen staan.
3. **Opslag koppelen**: in het project → *Storage* → *Create Database* → **Upstash for Redis** (gratis plan) → *Connect* aan dit project.
4. **Instellingen**: *Settings → Environment Variables*, voeg toe:
   | Naam | Waarde |
   | --- | --- |
   | `METRON_TOKEN` | je Metron-token (geen token-knop op Metron? Gebruik dan `METRON_USERNAME` en `METRON_PASSWORD`) |
   | `APP_SECRET` | een wachtwoord dat je zelf kiest (lang en willekeurig) |
   | `CRON_SECRET` | nog een willekeurige tekst (beveiligt de dagelijkse controle) |
   | `COMICVINE_API_KEY` | je Comic Vine-sleutel ([comicvine.gamespot.com/api](https://comicvine.gamespot.com/api/)), optioneel |
   | `ANTHROPIC_API_KEY` | Anthropic API-sleutel voor de aanraders ([console.anthropic.com](https://console.anthropic.com/)), optioneel; `ANTHROPIC_MODEL` kiest eventueel een ander model |
5. **Opnieuw uitrollen**: *Deployments* → bij de bovenste ⋯ → *Redeploy*.
6. **Op je telefoon**: open `https://<jouw-project>.vercel.app`, zet hem op je beginscherm (Deel → *Zet op beginscherm*) en ga naar **Mijn kast → ⚙ → Koppelen** met je `APP_SECRET`.

Elke push naar `main` zet Vercel automatisch online. De GitHub Pages-versie blijft ook bestaan; daar vul je bij Koppelen het Vercel-adres in als serveradres.

## Techniek

Gewone HTML, CSS en JavaScript-modules, zonder build-stap en zonder afhankelijkheden.

```
index.html, css/, icons/     de app (PWA: installeerbaar, werkt offline)
js/model.js                  datamodel, bladwijzer-logica, sync-samenvoegen, Metron-omzetting (puur, getest)
js/store.js, js/sync.js      opslag op het apparaat, automatische sync
js/api.js                    praat met de server
js/views/                    schermen
api/                         serverfuncties (Vercel): status, sync, cron, metron/{search,series,issues}, comicvine/{search,series}
api/_lib/                    Metron- en Comic Vine-client (limieten + cache), opslag (Upstash REST), controle op nieuwe delen
vercel.json                  dagelijkse taak en instellingen
tools/dev-server.js          lokaal draaien, met nep-Metron en nep-opslag
tests/                       node --test (tests/fixtures: testdata)
```

**Samenvoegen bij sync**: per serie en per volume wint de laatst gewijzigde versie. Verwijderen wordt onthouden, zodat een ander apparaat het niet terugzet. Metron is leidend voor titels, covers, datums en de issue-lijst; leesstatus, bezit, notities en vinkjes zijn altijd van jou.

**Metron-limieten** (20 verzoeken per minuut, 5000 per dag): de server leest de limiet-headers, wacht zo nodig, en bewaart issue-details een week in de cache.

Lokaal:

```bash
npm start      # http://localhost:5173, met nep-Metron en nep-opslag (wachtwoord: geheim)
npm test       # alle tests
REAL=1 METRON_TOKEN=… APP_SECRET=… KV_REST_API_URL=… KV_REST_API_TOKEN=… npm start   # tegen de echte diensten
```

## Volgende stappen

- Pushmeldingen bij nieuwe delen.
- Statistieken en eigen foto's als cover.
