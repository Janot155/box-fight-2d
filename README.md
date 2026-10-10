# Box Fight 2D — webová verze

Statická webová verze hry: po zveřejnění na HTTPS otevře hru kdokoliv v moderním prohlížeči, bez stahování `.vbs` launcheru. Stránka je přizpůsobená desktopu i mobilu a obsahuje manifest/service worker pro možnost instalace jako webové aplikace.

## Nasazení na Vercel přes GitHub

1. Rozbal `Box_Fight_2D_Website.zip`.
2. Vytvoř na GitHubu nový repozitář a nahraj do jeho kořene všechny soubory z této složky (`index.html`, `manifest.webmanifest`, `service-worker.js`, `icon.svg`, `robots.txt`, `vercel.json`).
3. Otevři [Vercel New Project](https://vercel.com/new), připoj GitHub a importuj tento repozitář.
4. Nastav Framework Preset na **Other**. Root Directory ponech `./`, Build Command nech prázdný (není potřeba build) a Output Directory nastav na `.`.
5. Klikni na **Deploy**. Po úspěšném nasazení Vercel ukáže veřejnou HTTPS adresu `*.vercel.app`; tu můžeš poslat ostatním.

Dokumentace Vercelu: https://vercel.com/docs/git

## Co je součástí

- Výběr jazyka v Settings / Nastavení (čeština, angličtina, francouzština); volba se ukládá do daného prohlížeče.
- Locker, Loadout, náhledy skinů a hra zabalena v `index.html`.
- PWA manifest, ikona a základní offline cache.
- Online 1v1 potřebuje internet i při otevření webu; cache se týká pouze aplikačního shellu.

## Poznámky

- Nejde o serverovou hru se sdílenými účty: hodnoty v `localStorage` (například nastavení a kosmetické volby) patří konkrétnímu zařízení/prohlížeči.
- Veřejná adresa vznikne až po nasazení v hostingovém účtu; tento ZIP obsahuje připravené soubory webu, ne již publikovanou URL.
