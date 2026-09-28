# Freaking Comics

Houd bij welke comics je gelezen hebt. Per serie een bladwijzer, altijd zichtbaar welk deel het volgende is, en een pop-art jasje. Gegevens en covers komen automatisch van [Metron](https://metron.cloud), je kast synct tussen je apparaten, en elke ochtend kijkt de server of er nieuwe delen zijn.

## Wat de app kan

- **Serie zoeken op Metron** en in één keer binnenhalen: alle delen, titels, covers, verschijningsdatums en welke issues erin zitten.
- **Bestaande series en losse boeken koppelen** aan Metron. Je leesstatus, bezit en gelezen issues blijven altijd van jou.
- **Bladwijzer per serie**: "Verder lezen" op Home, laatst gelezen bovenaan, met één tik op *Uit!* naar het volgende deel.
- **Nieuwe delen automatisch**: elke ochtend om ±07:00 controleert de server je gekoppelde series. Nieuwe delen verschijnen op Home onder *Nieuw verschenen*; aangekondigde delen onder *Binnenkort*. Het aantal nieuwe delen staat ook als getal op het app-icoon (waar je telefoon dat ondersteunt).
- **Sync tussen apparaten**: automatisch bij openen, na elke wijziging en elke 5 minuten. Werkt ook offline; wijzigingen gaan mee zodra je weer internet hebt.
- Leesstatus en kaststatus, issues afvinken, pauze, tussendoor-delen, verlanglijst, ongedaan maken, back-up.

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
api/                         serverfuncties (Vercel): status, sync, cron, metron/{search,series,issues}
api/_lib/                    Metron-client (limieten + cache), opslag (Upstash REST), controle op nieuwe delen
vercel.json                  dagelijkse taak en instellingen
tools/dev-server.js          lokaal draaien, met nep-Metron en nep-opslag
tests/                       node --test
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

- Leesroutes ("Alleen hoofdverhaal", "+ Toch lezen") en aanraders.
- Pushmeldingen bij nieuwe delen.
- Statistieken en eigen foto's als cover.
