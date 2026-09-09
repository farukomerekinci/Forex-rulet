# Forex Rulet

Tek telefondan sırayla oynanan, bilmediğin para birimleri üzerine kurulu bir takas ruleti.

**100 euro** ile masaya oturursun. Her tur rulet döner ve elindeki paraya karşılık **başka bir
para biriminden** bir takas teklifi gelir.

Kendi pozisyonun her zaman şeffaftır: bakiyenin ve masa ücretinin euro karşılığını sürekli
görürsün. Gizli olan tek şey **teklifin ne ettiğidir** — onu kurları bilerek ya da sezerek
kestirmek zorundasın.

Kararından sonra teklifin gerçek değeri açılır — kabul ettiysen kazancın, pas geçtiysen
kurtardığın ya da kaçırdığın miktar euro olarak yazılır. Yani her tur bir şey öğrenirsin.

Her tur masaya bir ücret ödersin ve bu ücret durmadan büyür. Sürekli pas geçersen paran erir,
her teklifi kabul edersen egzotik bir kağıtta silinirsin.

## Oyun kuralları

| | |
|---|---|
| **Başlangıç** | 100 EUR |
| **Havuz** | 149 para birimi, 4 risk kademesinde |
| **Masa ücreti** | *Körleme:* 1 € değerinde, her 4 turda ikiye katlanır<br>*Komisyon:* servetin %1'i, oran her 4 turda ikiye katlanır |
| **Kur kontrolü** | Oyun başına 3 hak — teklifin gerçek euro değerini, elindekine göre farkını ve piyasa kurunu açar |
| **Kulis** | Her teklifle gelen, %68 doğru bir dedikodu |
| **Skor** | Oyun boyunca ulaşılan **en yüksek euro değeri** + o an elde tutulan para birimi |
| **Bitiş** | Masa ücretini ödeyemediğin an |

Risk kademesi yükseldikçe teklifin sapması büyür: bilindik para birimlerinde teklif kurun
birkaç puan etrafında gezinirken, egzotik kağıtlarda paranı beşe katlayabilir ya da onda birine
indirebilir. Egzotik tarafın beklenen getirisi daha yüksektir; medyanı ise daha düşük.

## Tek telefonda çok oyunculu

Ana ekrandan 8 kişiye kadar takma ad eklenir. Herkes sırayla kendi turunu oynar, aralarda
"telefonu şuna ver" ekranı gelir, sonunda turnuva sıralaması çıkar. Rekorlar tarayıcıda
(`localStorage`) saklanır.

## Çalıştırma

Derleme adımı yok — düz HTML/CSS/JS.

```bash
python3 -m http.server 8000
# http://localhost:8000
```

`index.html` dosyasını doğrudan tarayıcıda açmak da yeterlidir.

## Dosyalar

```
index.html         ekranlar
styles.css         tema
js/currencies.js   para birimi havuzu + risk kademeleri
js/game.js         oyun motoru, rulet çizimi, skor tablosu
```

## Kurlar hakkında

`js/currencies.js` içindeki kurlar oyun için **dondurulmuş yaklaşık değerlerdir**, canlı piyasa
verisi değildir. Oyun hiçbir ağ isteği yapmaz; tamamen çevrimdışı çalışır.
