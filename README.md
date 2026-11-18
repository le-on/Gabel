# Gabel gegen Gänge

Ein eigenständiger Roguelite-Autobattler: Leonie serviert sechs Gänge, Gabriel alias Gabel verteidigt sich mit Alltagsgegenständen und Ausreden. Die Webfassung trägt den Namen „Gabel gegen Gänge“ – Gabel im Namen, keinen Bissen im Sinn. Daneben gibt es einen älteren nativen Godot-Prototyp.

## Browser-Version starten (aktueller Prototyp)

`dist/index.html` direkt im Browser öffnen. Das Spiel benötigt keine Installation, keine Internetverbindung und keine zusätzlichen Bibliotheken.

Optional aus diesem Projektordner mit einem lokalen Webserver starten:

```sh
python3 -m http.server 8080 --directory dist
```

Danach `http://localhost:8080` öffnen.

## Shop, Kampf und Begegnungen

Die Web-Version trennt Vorbereitung, Kampf und Begegnungen in eigene Ansichten:

- **Shop:** Tischaufstellung, Reserve, ausgewählter Gegenstand und die vier Angebote. Willenskraft, Münzen und Gang bleiben oben im Blick. Der angekündigte Gegnerplan ist kurz zusammengefasst; Details zu Gerichten, Wirkungen und Kombinationen lassen sich bei Bedarf aufklappen oder per Hover/Tab ansehen.
- **Kampf:** Das Spielfeld steht allein im Mittelpunkt. Sichtbar bleiben Willenskraft, Schild, abgewehrte Gerichte sowie Pause und Geschwindigkeit. Die vorbereiteten Gegenstände arbeiten automatisch; Käufe und Änderungen an der Aufstellung finden erst im nächsten Shop statt.
- **Begegnung:** Zwischen zwei Gängen steht eine kurze persönliche Situation mit drei Antworten im Mittelpunkt. Alle Kosten und Folgen sind vor der Wahl lesbar. Danach öffnet sich der nächste Shop; die Rundenauswertung bleibt während der Begegnung ausgeblendet.
- **Nach dem Gang:** Ein schmaler Rückblick meldet das Ergebnis und den Münzgewinn. Die vollständige Auswertung öffnet sich ausschließlich über „Auswertung“ in einem eigenen Dialog. Sie erscheint nach einem Gang oder beim Laden eines Spielstands nicht automatisch.

Nach Gang 2 und 4 folgt in neuen Durchläufen zunächst eine Begegnung und danach der Shop. Nach den anderen überstandenen Gängen geht es direkt in den Shop beziehungsweise nach dem Finale zum Ergebnis. Ein gespeicherter laufender Kampf wird auf der Kampfansicht pausiert fortgesetzt.

## Persönliche Ereignisse

Nach Gang 2 und 4 erscheint jeweils eine zufällig ausgewählte Begegnung aus diesem Pool. Ein Durchlauf enthält somit zwei verschiedene Ereignisse; ihre Auswahl bleibt beim Neuladen erhalten:

| Begegnung | Entscheidung und Wirkung |
| --- | --- |
| Anka ruft an | Luca geht ans Telefon, während Gabriel lieber weiterzocken würde. Wähle Gaming-Stärke, Pfand gegen Willenskraft oder einen gemeinsamen Call mit Start-Schild. |
| Die Bluetooth-Lampe | Die Nachbarin übernimmt Gabriels Lampe. Verbindung zurückholen kostet Pfand und verkürzt Aufladezeiten; Discolicht gibt Schild gegen etwas Stärke; Ausschalten stellt Willenskraft wieder her. |
| Yusuf meldet sich | Gabriels Sprachassistent auf dem Raspberry Pi bietet Fokusmodus, Pfandsuche oder Ruhe. Stärke kostet Pfand; gefundenes Pfand bedeutet längere Aufladezeiten; Ruhe heilt. |
| Update vor der Runde | Sofort weiterspielen tauscht Willenskraft gegen Stärke. Patchen kostet Pfand und verkürzt Aufladezeiten. Offline spielen gibt Start-Schild. |
| Leonie funkt durch | Am Walkie-Talkie lässt sich Zeit gewinnen: Start-Schild, mehr Gaming-Stärke samt etwas Pfand oder bezahlte Tischvorbereitung mit mehr Stärke. |

Geld und Willenskraft ändern sich sofort. Stärke- und Aufladeeffekte sowie Start-Schild gelten ausschließlich für den nächsten Gang. Ein kleiner Hinweis im Shop und Kampf zeigt den aktuellen Effekt; die angezeigten Itemwerte berücksichtigen ihn. Die Bank erhält keine aktiven Boni. Zu teure oder tödliche Entscheidungen sind mit Erklärung gesperrt; eine kostenlose Antwort bleibt verfügbar.

Die Begegnungsreihenfolge verwendet einen eigenen Seed und verändert weder Angebote noch Gegnerformationen. Offene Entscheidungen, Ergebnisse und Effekte werden gespeichert; Neuladen würfelt sie nicht neu und zahlt keine Belohnung doppelt aus. Bereits begonnene ältere Durchläufe ohne Ereignissystem behalten ihren bisherigen Ablauf. Für die Begegnungen einen neuen Durchlauf starten.

## Neue Gegenstände in der Web-Version

Für das schnelle Prototyping wird aktuell die Web-Version erweitert. Sie enthält zusätzlich zehn kaufbare Basisgegenstände; die Godot-Version bleibt auf ihrem bisherigen Stand.

| Gegenstand | Wirkung | Passt besonders zu |
| --- | --- | --- |
| Kühles Bier → Sixpack → Bierkasten | Baut Schild auf und verkürzt die verbleibenden Aufladezeiten direkter Nachbarn. Stufe 1 ist eine Flasche, Stufe 2 ein Sixpack und Stufe 3 ein Bierkasten. | Snus, Luca |
| Snus → Päckchen Snus → 10er-Pack Snus | Stufe 1 zeigt einen einzelnen Snusbeutel, Stufe 2 ein Päckchen und Stufe 3 einen 10er-Pack. Bereitet einen Mundschutz für den nächsten normalen Bissen vor. Der Puffer gilt auch gegen Suppe, stapelt sich nicht und blockiert das Dessert nicht. | Bier, Serviette |
| Luca | Trifft das vorderste Gericht und beschleunigt einen aufladenden Gaming-Nachbarn. Durch gemeinsame Gaming-Aktivierungen baut er Momentum auf. | Discord, Desolator, Bier |
| Dota 2 – Desolator | Verursacht Schaden und markiert sein Ziel für drei Sekunden. Folgende Treffer sind 25 % stärker. | Luca und starke Einzelangriffe |
| CS2 – AWP | Zwei kräftige Schüsse im Abstand einer Sekunde, danach eine lange Nachladepause. Die Hälfte des Schussschadens umgeht den Käse-Schild. | Headset, Desolator |
| Batomon Showdown | Trifft zwei Gerichte nach seiner eingestellten Priorität; gegen Erbsen und Brokkoli ist der Schaden doppelt so hoch. | Unfertiges Paper |
| Lanz & Precht | Trifft und verlangsamt zwei vordere Gerichte. Jeder dritte tatsächlich ausgelöste Gedanke trifft alle anwesenden Gerichte und hält sie länger auf. Die Anzeige am Tisch zeigt den Fortschritt. | Headset, Paper, Walkie-Talkies |
| Umut | Entfernt zuerst Käse-Schild und trifft sein Ziel. Die Beschichtung verhindert vorübergehend Heilung durch Support-Suppen; tatsächlich verhinderte Heilung steht in der Auswertung. | Luca, Discord |
| Walkie-Talkies | Baut Schild auf und beschleunigt genau den besetzten, gerade aufladenden Platz gegenüber: 1 ↔ 6, 2 ↔ 5, 3 ↔ 4. Der sichtbare Funklink erscheint nur bei wirklicher Aufladehilfe. | Lanz & Precht, Snus; gezielt platzierte Items gegenüber |
| Ritalin | Lädt alle waagerecht und senkrecht angrenzenden Items früher auf: bis zu 1,2 / 1,5 / 1,8 Sekunden auf Stufe 1 / 2 / 3. Kostet 6 Pfand; Ausgangs-Abklingzeit 6 Sekunden. Mintgrüne Verbindungen und Blitze markieren die tatsächlich beschleunigten Nachbarn. | Starke Angriffe mit langer Wartezeit und wiederkehrende Unterstützung |

Die Tooltips zeigen die Werte nach Stufen- und Nachbarschaftsboni. Die Stufenformen von Bier und Snus haben jeweils eigene Grafiken auf Tisch, Bank, in Kauf-/Upgradevorschauen und in Tooltips. Sie bleiben dieselben Basisitems im Shop; zwei gleiche Stufen fusionieren wie gewohnt zur nächsten Stufe.

## Taktiken, Formationen und Auslöserketten

Der Kampf bleibt vollständig automatisch. Die Entscheidungen fallen vor dem Servieren: angekündigte Formation lesen, Gegenstände anordnen und bei passenden Gegenständen die Zielpriorität wählen. Die Taktik bleibt am Gegenstand gespeichert, auch beim Verschieben oder auf der Fensterbank. Während eines Kampfes ist sie gesperrt.

| Gegenstand | Taktik 1 | Taktik 2 |
| --- | --- | --- |
| AWP | Bedrohungen wie Boss und Unterstützung priorisieren | Markierte Gerichte für die Desolator-Kombination priorisieren |
| Batomon Showdown | Grünes Gemüse bevorzugen | Geschwächte Gerichte aufräumen |
| Desolator | Das vorderste Gericht markieren | Gepanzerte Gerichte priorisieren |
| Luca | Den stärksten aufladenden Gaming-Nachbarn beschleunigen | Den Gaming-Nachbarn mit der längsten Restaufladung beschleunigen |

Im Shop kündigt die kompakte Gegnerübersicht Leonies nächste Formation an. Ein Gemüseschwarm verlangt Flächenschaden; in einer Unterstützungsformation heilt die Suppe andere Gerichte. Expressgerichte erreichen Gabriel schneller, während ein Familienessen wenige kräftige Portionen bringt. Das Finale enthält weiterhin das Dessert, das nicht durchkommen darf. Der Ablauf ist pro Seed festgelegt und ändert sich beim Öffnen des Shops oder bei einer Kaufvorschau nicht.

Automatische Auslöserketten verbinden die Gegenstände:

- **Markierter Abschuss:** Wenn die AWP ein markiertes Gericht beseitigt, werden die verbleibenden Aufladezeiten benachbarter Luca-Gegenstände um 1,5 Sekunden verkürzt.
- **Snus und Bier:** Ein durch Snus geblockter Bissen verkürzt die verbleibenden Aufladezeiten benachbarter Bier-Gegenstände um zwei Sekunden.
- **Bier und Gaming:** Bier verstärkt den nächsten normalen Angriff benachbarter Gaming-Gegenstände jeweils um 20 %. Die Verstärkung stapelt sich nicht.
- **Gaming-Rhythmus:** Eigene und benachbarte Gaming-Aktivierungen bauen bei Luca Momentum auf. Alle drei Aktivierungen erhält er eine Stufe, bis zu fünf. Jede Stufe verstärkt seine Wirkung um 10 %.
- **Noch ein letzter Gedanke:** Jede dritte tatsächliche Aktivierung von Lanz & Precht trifft alle anwesenden Gerichte und verlangsamt sie länger. Ohne Ziele bleibt der Zähler stehen.

Reaktionen lösen keine weiteren Reaktionen aus; die Abschuss- und Snus-Ketten haben zusätzlich vier Sekunden Sperrzeit pro auslösendem Gegenstand. Im Kampf erscheinen die tatsächlich ausgelösten Ketten neben den Effekten auf dem Tisch. AWP-Magazin, Lucas Momentum und der Gedankenzähler von Lanz & Precht machen ihre unterschiedlichen Zeitverläufe sichtbar. Jeder dritte Podcast-Gedanke löst den Flächeneffekt aus. Umuts Beschichtung unterbricht Heilung zeitlich begrenzt, während Walkie-Talkies gezielt den festen Platz gegenüber unterstützen.

Leonie setzt dem größeren Budget stärker wachsende Portionen, Käse-Schilde, Tempo und Biss-Schaden entgegen. Das Dessert verlangt eine ausgebaute Verteidigung.

Die bei Bedarf geöffnete Kampfauswertung hält nach jedem Gang den tatsächlichen Beitrag jedes Gegenstands fest: Schaden, überschüssigen Schaden, Aktivierungen, Abschüsse, Schutz und beschleunigte Aufladezeit. Durchgekommene Gerichte, ausgelöste Ketten und Hinweise helfen beim Umbau für den nächsten Gang.

Im Kampf unterscheiden sich Effekte durch Form und Bewegung: goldene Sterne für Stärke-Synergien, blaue Uhren für kürzere Aufladezeiten und Kaffeetassen für die passive Kaffee-Aura. Tatsächlich unterstützte Items werden verbunden: Bier mit bernsteinfarbenen Punkten, Luca mit violetten Pfeilen, Walkies mit gestrichelten Funksignalen und Ritalin mit mintfarbenen Blitzen. Schild erscheint als goldenes Sechseck, Snus als mintfarbener Blockmarker. Hitze, Verlangsamung, Discord, Einpacken, Farbe und Präzision haben eigene Trefferformen.

Aktive Auslöserketten erhalten kräftigere Verbindungen und passende Empfängermarker. AWP → Luca erscheint erst beim tatsächlichen sichtbaren Einschlag. Gespeicherter Bier-Fokus bleibt am Gaming-Item markiert, bis der Bonus verbraucht ist. Linien folgen den Itemzentren auch beim Ändern der Fenstergröße; kurze Impulse laufen mit dem Spieltempo und bleiben während der Pause stehen. Bei reduzierter Bewegung bleiben die Informationen als ruhige Marker sichtbar.

## Spielen

- Vor jedem Gang die Gegenstände auf den sechs Tischplätzen (2 × 3) anordnen. Ein Gegenstand lässt sich anklicken und anschließend durch Klick auf einen anderen Platz verschieben oder tauschen; alternativ ziehen und ablegen. Im Kampf erscheint dieselbe Ausrüstung auf dem Tisch; ihre Aufstellung lässt sich im Shop ändern.
- Mit dem Mauszeiger über einen Gegenstand oder ein Shop-Angebot fahren, um Wirkung, aktuelle Stärke, Aufladezeit und passende Synergien zu sehen. Die Hilfe erscheint auch beim Tastaturfokus und lässt sich mit Escape schließen.
- Gegenstände direkt nebeneinander oder übereinander können Synergien aktivieren. Diagonale Nachbarn zählen nicht. Die angezeigten Kombinationen helfen bei der Planung.
- Vor dem Kauf die angekündigte Formation prüfen; „Gegner & Tipps“ öffnet die vollständige Vorschau. Bei AWP, Batomon, Desolator oder Luca einen Gegenstand auswählen und eine der beiden automatischen Taktiken einstellen.
- Den Gang starten: Alle Gegenstände arbeiten automatisch. Auslösende Gegenstände leuchten auf dem Tisch auf; Projektile, Treffer und Schild-Effekte zeigen, was sie bewirken. Gerichte, die Gabriel erreichen, verbrauchen Willenskraft; Ausreden-Schilde fangen einen Teil davon ab. Bei null Willenskraft ist der Durchlauf verloren.
- Gabriel beginnt mit einer Serviette, einem unfertigen Paper und **12 Pfandmünzen**. Vor dem ersten und zwischen den weiteren Gängen bietet der Shop vier Gegenstände an. Die Gangbelohnungen steigen auf **12, 14, 16, 18, 20 und 22 Pfand**. Die Vorschau im Shop zeigt den nächsten tatsächlichen Ertrag; ungenutztes Geld bleibt erhalten.
- Die Preisklassen sind **Alltagstauglich: 4**, **Besonders praktisch: 6** und **Selten & begehrt: 9 Münzen**. Ein Kauf kommt auf einen freien Tischplatz, bei vollem Tisch auf die Reservebank. Zwei identische Gegenstände derselben Stufe fusionieren automatisch zur nächsten Stufe. Vier Exemplare der Grundstufe ergeben somit einen Gegenstand auf der höchsten **Stufe 3**.
- **Direkt aufwerten:** Wähle einen Gegenstand auf dem Tisch oder auf der Bank. Sein Aufwertungsbutton zeigt Preis und nächste Stufe; darunter stehen die Werte nach der Änderung. Stufe 1 → 2 kostet den Basispreis des Gegenstands (**4/6/9 Pfand**), Stufe 2 → 3 den doppelten Basispreis (**8/12/18 Pfand**). Vorhandene gleiche Stufen fusionieren dabei weiterhin automatisch; die Vorschau zeigt auch eine mögliche Kaskade bis Stufe 3. Kauf von Duplikaten und direktes Aufwerten lassen sich kombinieren. Bezahlte Aufwertungen zählen beim späteren Verkauf zur Investition.
- **Neu würfeln** ersetzt ungesperrte Angebote. Der erste Versuch pro Shop kostet **1**, der zweite **2**, alle weiteren **3 Münzen**. Interessante Angebote lassen sich sperren, damit sie beim Neuwürfeln und bis zum nächsten Gang erhalten bleiben.
- **Durchatmen** stellt für **4 Münzen einmal pro Shop 15 Willenskraft** wieder her, höchstens bis 100. Zwischen den Gängen gibt es keine kostenlose Heilung.
- **Verkaufen:** Unter der Tischaufstellung bleibt die Verkaufsfläche sichtbar. Wähle einen Gegenstand vom Tisch oder von der Bank und aktiviere dort „Verkaufen“; der Knopf zeigt den genauen Pfanderlös vorab. Alternativ ziehst du den Gegenstand direkt auf die Verkaufsfläche. Beide Wege geben die Hälfte seiner investierten Münzen zurück, abgerundet; bei Fusionen zählt die Summe der Kaufpreise. Kostenlose Startgegenstände bringen ausdrücklich **0 Pfand**, lassen sich aber ebenfalls entfernen. Ohne Auswahl ist der Verkaufsbutton deaktiviert.
- Die Reservebank hat **maximal drei Plätze**; der Zähler zeigt die Belegung. Gegenstände auf der Bank wirken nicht im Kampf und können vor dem nächsten Gang mit Gegenständen auf dem Tisch getauscht werden. Ist auch der Tisch voll, werden Käufe ohne Platz mit „Bank voll“ gesperrt. Käufe, die durch Fusion keinen zusätzlichen Platz brauchen, bleiben möglich. Bei älteren Spielständen mit mehr als drei Bank-Items bleibt die Ausrüstung erhalten; vor dem nächsten Kampf müssen überzählige Items aufgestellt, fusioniert oder verkauft werden.
- Nach sechs überstandenen Gängen einschließlich Leonies Dessert ist der Durchlauf gewonnen.

Der Spielstand wird automatisch lokal im Browser gespeichert. Beim erneuten Öffnen lässt sich der Durchlauf fortsetzen; ältere Spielstände werden übernommen. Vorhandenes Guthaben bleibt erhalten. Bereits laufende Kämpfe aus älteren Versionen behalten ihre ursprüngliche Gegnerfolge und Skalierung; die neuen Werte gelten für neu gestartete Gänge. Ein neuer Durchlauf ersetzt den bisherigen Spielstand. Browser können lokale Daten je nach Einstellung oder bei direkt geöffneten Dateien unterschiedlich speichern.

## Balancing vom 18. November 2026

Die Anpassung reduziert dauerhafte Kontrolle und gibt mehreren offensiven Builds eine Chance gegen das Dessert. Die Preise, Gangbelohnungen und Aufwertungskosten bleiben gleich. Geänderte Grundwerte:

| Gegenstand | Vorher | Jetzt |
| --- | --- | --- |
| Serviette | 20 Schaden | 18 Schaden |
| Heizlüfter | 7 Schaden alle 4,6 s; Rückstoß 0,065 / 0,025 gegen normale Gerichte / Boss | 8 Schaden alle 5 s; Rückstoß 0,045 / 0,008 |
| Headset | 5 Schaden alle 4,7 s; 2,4 s Verlangsamung | 6 Schaden alle 5,4 s; 2 s Verlangsamung |
| Brotdose | 30 Schaden | 32 Schaden |
| Discord | 9 Flächenschaden | 14 Flächenschaden |
| Gabel-Katapult | 15 Schaden je Ziel | 18 Schaden je Ziel |
| Luca | 12 Schaden | 14 Schaden |
| Desolator | 13 Schaden | 16 Schaden |
| Umut | 11 Schaden | 14 Schaden; Basis-Rüstungsabtrag bleibt bei 12 |
| Bier | Nachbarn 0,35 s früher bereit | Nachbarn 0,45 s früher bereit |
| Walkie-Talkies | 4 Schild; gegenüber 1 s früher bereit | 5 Schild; gegenüber 1,2 s früher bereit |

Headset-Dauer, Podcast-Dauer und Verlangsamungsstärke kommen direkt aus den Core-Statistiken in die Tooltips. Ritalin, AWP, Snus, Kaffee und Batomon behalten ihre Werte; sie funktionieren bereits in passenden Nachbarschaften. Mehrere Heizlüfter können den Boss jetzt nicht mehr dauerhaft am Rand festhalten.

Normale Gerichte erhalten nach Gang 1 etwas mehr Lebenspunkte: die Kurve steigt auf `1 + 0,8 × Gangindex + 0,08 × Gangindex²`. Das Dessert hat 720 statt 900 LP und bewegt sich langsamer (Faktor 0,85 statt 1,1). Dadurch zählen Schaden und Schutz während der Zwischenwellen mehr; das Finale erlaubt auch Builds ohne dauerhafte Verlangsamung. Laufende Kämpfe behalten ihre gespeicherte Gegner-Skalierung.

Seltene Items haben beim Auswürfeln Gewicht 2 statt 1; Alltag/Besonders bleiben bei 5/3. Ein allgemeines Angebot ist damit zu rund 9,5 % statt 5 % selten. Der garantierte günstige vierte Platz bleibt erhalten.

`balance.mjs` vergleicht drei feste Testspieler: ungenutzter Shop, wahllose Käufe und eine Heuristik mit Aufwertungen/Anordnung. Gemessen wurden dieselben 200 Seeds vor und nach der Änderung sowie weitere 200 Seeds zur Gegenprüfung: zusammen 2.400 vollständige Durchläufe. Die gezielt aufwertende Heuristik steigt von 55,5 auf 64 % Siege; in der Gegenprüfung von 59 auf 68 %. Ihre durchschnittliche Willenskraft vor dem Finale sinkt von 99,3 auf 92,7. Wahllose Käufe bleiben meistens erfolglos. Das sind Ergebnisse der Testspieler, keine prognostizierten Siegquoten für Menschen. Die Zusammenfassung samt Engine-Hashes steht in [balance-results.json](balance-results.json).

Zusätzlich wurden budgetierte Builds geprüft: Fünf von neun verschiedenen Ausrichtungen gewinnen das Testfinale gegenüber vorher zwei, darunter physische Angriffe, Voice-Crew und Schaden ohne Verlangsamung. Reine Defensive und übermäßig viele Unterstützer scheitern weiterhin. Die Tests sichern auch ab, dass drei Heizlüfter auf Stufe 3 das Dessert nicht endlos festhalten. Vorgegebene Builds prüfen die Kombinationen unabhängig von ihrer Verfügbarkeit im Shop.

Neue Messung aus diesem Ordner starten; gleiche Seedanzahl und denselben Prefix für vergleichbare Ergebnisse verwenden:

```sh
node balance.mjs --seeds 200 --prefix economy --json /tmp/gabel-balance.json
node balance.mjs --seeds 200 --prefix balance-check --json /tmp/gabel-balance-check.json
```

## Browser-Version prüfen

Die Spiellogik lässt sich mit Node.js ohne Installation von Paketen prüfen:

```sh
node engine.test.mjs
node ui.test.mjs
node audio.test.mjs
node check-assets.mjs
```

Die Tests decken unter anderem Nachbarschaften, Reservebank, Shop, bezahlte Aufwertungen und Fusionen, gestaffelte Gangbelohnungen, Zielprioritäten, Formationspläne, begrenzte Auslöserketten, Kampfauswertungen, Speichern während eines Kampfes sowie Siege und Niederlagen über verschiedene Seeds ab. Die zusätzliche Asset-Prüfung kontrolliert lokale Dateiverweise, die Verknüpfung der Oberfläche, SVG-Strukturen und JavaScript-Syntax für den direkten Offline-Start.

Die protokollierten Balancing-Messungen in `balance-results.json` stammen von vor der Einführung des Drei-Plätze-Banklimits und der Begegnungen; die gespeicherten Engine-Hashes kennzeichnen den jeweiligen Stand. `balance.mjs` berücksichtigt die aktuellen Kaufgrenzen und löst bei neuen Messungen jede Begegnung mit der ersten bezahlbaren Antwort. Benchmark-Version 2 vermerkt diese Wahlstrategie.

Die UI-Tests prüfen die tatsächlichen Bedienfunktionen mit einem kleinen DOM-Adapter: Spielstart, Tisch- und Inventarbedienung, Drag-and-drop, Hover- und Fokus-Hilfe, Shop-Aktionen, Aufwertungs-Vorschauen mit Kosten, Stufenlimit und Fusionskaskaden, sichtbare Verkäufe per Auswahl oder internem Drag-and-drop einschließlich Abbruch und ungültiger Drops, Taktikwechsel und deren Kampfsperre, Formationsanzeigen, getrennte Shop- und Kampfansichten, optionale Berichts-Dialoge, Ketten und Kampfauswertungen, Quell- und Zieleffekte, Leertastenpause, Wiederaufnahme, komplette Durchläufe und beschädigte oder nicht verfügbare Browser-Speicher. Sie ersetzen keine visuelle Prüfung im Browser.

## Sound

Über **♪** oben wird der Ton eingeschaltet. Die **Effektlautstärke** lässt sich in der Anleitung einstellen; beide Einstellungen werden lokal gespeichert. Standardmäßig ist der Ton aus.

Gegenstände haben eigene Klänge, darunter Papierwischen für die Serviette, Heißluft für den Heizlüfter, metallische Treffer und Funkknistern. Schutz, Blocken, Schaden, Synergien, Shop-Aktionen und Begegnungen sind akustisch unterscheidbar. Treffer erklingen beim sichtbaren Einschlag. Stereo-Positionen folgen den Effekten; bei höherem Spieltempo bleibt die Tonhöhe gleich. Eine Begrenzung gleichzeitiger Klänge und ein Kompressor halten den Mix auch bei vielen Auslösungen übersichtlich.

Pause, Menüs und ein Wechsel in den Hintergrund beenden laufende Klänge. Beim Fortsetzen werden keine alten Sounds nachgespielt. Alle Klänge entstehen lokal mit Web Audio; zusätzliche Audiodateien oder Downloads sind nicht nötig. Ohne Web-Audio-Unterstützung bleibt das Spiel lautlos spielbar. Die Audio-Tests prüfen Signalwege, Klangbausteine, Lautstärke, Begrenzungen und das sichere Beenden geplanter Klänge; die UI-Tests ergänzen Bedienung und Treffer-Timing.

## Godot-Version starten

```sh
./start-godot.sh
```

Das Script startet die native Fassung mit der vorhandenen Godot-Executable. Zum Bearbeiten `godot/project.godot` in Godot öffnen oder `./start-godot.sh --editor` ausführen und im Editor F5 drücken. Die vollständige Anleitung und die nativen Tests stehen in [godot/README.md](godot/README.md).

## Dateien

| Datei | Inhalt |
| --- | --- |
| `dist/index.html` | Spieloberfläche und Einstiegspunkt |
| `dist/style.css` | Darstellung und responsive Layouts |
| `dist/engine.js` | Spiellogik, Gegner, Gegenstände und Synergien |
| `dist/app.js` | Bedienung, Animationen und lokaler Spielstand |
| `dist/audio.js` | Lokale Sounds, Lautstärke und Begrenzung gleichzeitiger Klänge |
| `dist/assets/` | Lokale SVG-Illustrationen |
| `engine.test.mjs` | Automatische Tests der Spiellogik |
| `ui.test.mjs` | Integrationstests der Bedienung und Speicherung |
| `audio.test.mjs` | Tests der Klänge und Audio-Lebenszyklen |
| `check-assets.mjs` | Prüfung der Offline-Dateien und UI-Verknüpfungen |

Das vorhandene Spiel im Nachbarordner `gabriel-30/` ist unabhängig von diesem Projekt.
