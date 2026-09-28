# Freaking Comics

Houd bij welke comics je gelezen hebt. Per serie een bladwijzer, altijd zichtbaar welk deel het volgende is, en een pop-art jasje.

**App:** https://joshuavangelder.github.io/freaking-comics/

## Op je telefoon zetten

1. Open de link hierboven op je telefoon.
2. **iPhone (Safari):** tik op Deel (vierkantje met pijl) → *Zet op beginscherm*.
   **Android (Chrome):** tik op ⋮ → *App installeren* of *Toevoegen aan startscherm*.
3. Freaking Comics staat nu als los icoon tussen je apps, opent schermvullend en werkt ook zonder internet.

Je gegevens staan op je telefoon zelf. Maak af en toe een back-up via **Mijn kast → ⚙ → Back-up downloaden**.

## Wat versie 0.1 kan

- **Series en volumes toevoegen**, met deelnummer, plek in de serie, formaat en de issues die erin zitten (`#1–8, Annual #1`, of per regel een andere serie voor boeken als *Divided We Fall*).
- **Statussen**: leesstatus (nog niet / bezig / gelezen) en kast (niet / in bezit / verlanglijst). Bij boeken met issues vink je per issue af; de status van het boek volgt vanzelf.
- **Bladwijzer per serie**: "Verder lezen" op Home toont alle series waar je mee bezig bent, laatst gelezen bovenaan. Eén tik op *Uit!* en de bladwijzer schuift door naar het volgende deel.
- **Pauze**: zet een serie op pauze; zodra je er weer in leest, gaat hij vanzelf verder.
- **Tussendoor-delen** (zijverhalen, tie-ins) tellen niet mee voor "volgende deel", tenzij je ze aan het lezen bent.
- **Verlanglijst**, met een knop *Gekocht*.
- **Ongedaan maken** na elke leesactie, en back-up downloaden/terugzetten.

Bij de eerste start staat je leesstapel uit het plan er al in: The Flash (New 52) met Vol. 1–5 gelezen, en Ultimate Comics met *Divided We Fall, United We Stand* (18 issues) en Ultimate Comics Iron Man.

## Techniek

Gewone HTML, CSS en JavaScript (ES-modules), zonder build-stap en zonder afhankelijkheden. Gegevens in `localStorage`, een service worker voor offline gebruik, en een web-app-manifest voor het icoon.

```
index.html              ingang
css/app.css             pop-art stijl
js/model.js             datamodel en alle logica (puur, getest)
js/store.js             opslag, ongedaan maken, back-up
js/seed.js              startdata uit het plan
js/views/*.js           schermen: Home, Mijn kast, Serie, Volume, formulieren, instellingen
sw.js                   offline
tests/model.test.js     tests
```

Lokaal draaien en testen:

```bash
npm start      # http://localhost:5173
npm test       # node --test, geen installatie nodig
```

Elke push naar `main` draait de tests en zet de app op GitHub Pages.

## Volgende stappen

1. ~~Eerste werkende versie~~ ✔
2. Metron koppelen voor gegevens en covers (Comic Vine als aanvulling).
3. Leesroutes ("Alleen hoofdverhaal", "+ Toch lezen") en aanraders.
4. Extra's: releasekalender, statistieken, eigen foto's als cover.
