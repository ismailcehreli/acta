import { dayanikliGoto } from "./gezinme";
import { expect, test, type Page } from "./test-tabani";

import { E2E_ADMIN, E2E_GM, e2ePassword } from "./global-setup";

// Duyarlılık denetimi (tasarım Faz 9).
//
// Bu dosya "güzel görünüyor mu" diye bakmaz — **ölçer**. Üç şey sınanır:
//
//  1. Hiçbir ekran yatay kaydırma üretmiyor. Taşma, dar ekranda tasarımın
//     en sık ve en sessiz kırılma biçimidir: sayfa çalışır görünür, içerik
//     ekranın dışındadır.
//  2. Dokunma hedefleri 44px. Telefonda alt sekme çubuğu ana gezinmedir;
//     32px'lik bir hedef parmakla ıskalanır.
//  3. Metin/zemin karşıtlığı WCAG AA eşiğini geçiyor. Belirteçler oklch ile
//     yazıldı; göz kararı "yeterince koyu" demek ölçüm değildir.
//
// Ekran görüntüleri `test-results/goruntu/` altına düşer (depoya girmez).
//
// **Süre bütçesi ayrı verilir** (denetim 21.08.2026, bulgu 18). Her
// ölçü testi iki kez giriş yapıp 11 rota geziyor, her rotada ağ sakinleşmesini
// bekleyip tam sayfa görüntü alıyor. Varsayılan 30 saniye bu iş için değil;
// dolayısıyla `pnpm e2e` bu dört testi kendi bütçesiyle düşürüyor ve kalite
// kapısı gerçek bir gerilemeyi gürültüden ayıramaz hâle geliyordu.
//
// Süreyi uzatmak hatayı gizlemez: ölçümler tek işçiyle 23–28 saniye sürüyor,
// tam pakette daha da yavaşlıyor. Buradaki değer ölçülmüş süreye pay bırakır.
test.describe.configure({ timeout: 150_000 });

const GENISLIKLER = [
  { ad: "390-telefon", width: 390, height: 844 },
  { ad: "768-tablet", width: 768, height: 1024 },
  { ad: "1024-kucuk-masaustu", width: 1024, height: 768 },
  { ad: "1440-masaustu", width: 1440, height: 900 },
];

const ROTALAR = [
  { yol: "/", ad: "ana-ekran" },
  { yol: "/activities", ad: "faaliyetler" },
  { yol: "/activities/new", ad: "yeni-faaliyet" },
  { yol: "/approvals", ad: "onaylar" },
  { yol: "/follow-ups", ad: "takip" },
  { yol: "/search", ad: "arama" },
  { yol: "/team/absence", ad: "ekip-isaretleri" },
];

// Yönetim rotaları sistem yöneticisiyle gezilir; genel müdürde bu ekranlar
// yetki uyarısı gösterir (doğru davranış, ama tasarımı sınamaz).
const YONETIM_ROTALARI = [
  { yol: "/admin/org", ad: "yonetim-organizasyon" },
  { yol: "/admin/users", ad: "yonetim-kullanicilar" },
  { yol: "/admin/settings", ad: "yonetim-ayarlar" },
  { yol: "/admin/audit", ad: "yonetim-denetim" },
];

async function girisYap(page: Page, eposta: string = E2E_GM.email) {
  await page.context().clearCookies();
  await dayanikliGoto(page, "/login");
  await page.getByLabel("E-posta", { exact: true }).fill(eposta);
  await page.getByLabel("Parola", { exact: true }).fill(e2ePassword());
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Sayfanın yatay taşması var mı? 1px tolerans yuvarlama içindir. */
async function yatayTasma(page: Page) {
  return page.evaluate(() => {
    const belge = document.documentElement;
    return {
      scrollWidth: belge.scrollWidth,
      clientWidth: belge.clientWidth,
      tasan: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((el) => {
          const k = el.getBoundingClientRect();
          return k.width > 0 && k.right > belge.clientWidth + 1;
        })
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 60)}`),
    };
  });
}

for (const olcu of GENISLIKLER) {
  test(`${olcu.ad}: hiçbir ekran yatay kaydırma üretmiyor`, async ({ page }) => {
    await page.setViewportSize({ width: olcu.width, height: olcu.height });

    for (const [eposta, liste] of [
      [E2E_GM.email, ROTALAR],
      [E2E_ADMIN.email, YONETIM_ROTALARI],
    ] as const) {
      await girisYap(page, eposta);

      for (const rota of liste) {
        await dayanikliGoto(page, rota.yol);
        // Sayfanın yerleşimi otursun; görüntü ve ölçüm aynı ana ait olsun.
        await page.waitForLoadState("networkidle");

        await page.screenshot({
          path: `test-results/goruntu/${olcu.ad}--${rota.ad}.png`,
          fullPage: true,
        });

        const olcum = await yatayTasma(page);
        expect(
          olcum.scrollWidth,
          `${rota.yol} @${olcu.width}px taşıyor; taşan öğeler: ${olcum.tasan.join(" | ")}`,
        ).toBeLessThanOrEqual(olcum.clientWidth + 1);
      }
    }
  });
}

test("telefonda alt sekme çubuğu 44px dokunma hedefi veriyor", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await girisYap(page);

  const sekmeler = page.getByRole("navigation", { name: "Birincil gezinme" }).getByRole("link");
  const sayi = await sekmeler.count();
  expect(sayi).toBeGreaterThan(0);

  for (let i = 0; i < sayi; i += 1) {
    const kutu = await sekmeler.nth(i).boundingBox();
    expect(kutu, `sekme ${i} ölçülemedi`).not.toBeNull();
    expect(kutu!.height, `sekme ${i} yüksekliği`).toBeGreaterThanOrEqual(44);
  }
});

test("metin renkleri WCAG AA karşıtlık eşiğini geçiyor", async ({ page }) => {
  await girisYap(page);

  const olcumler = await page.evaluate(() => {
    // sRGB bağıl parlaklığı (WCAG 2.x tanımı).
    function parlaklik(renk: string) {
      const [r, g, b] = renk
        .replace(/^rgba?\(|\)$/g, "")
        .split(/[\s,/]+/)
        .slice(0, 3)
        .map(Number)
        .map((deger) => {
          const o = deger / 255;
          return o <= 0.03928 ? o / 12.92 : ((o + 0.055) / 1.055) ** 2.4;
        });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    function oran(on: string, arka: string) {
      const a = parlaklik(on);
      const b = parlaklik(arka);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }

    // Belirteçler oklch ile yazıldı; getComputedStyle bunları rgb'ye
    // çevirmez. Tuvale boyayıp pikseli okumak, tarayıcının **ekrana
    // basacağı** rengi verir — dönüşümü elle yeniden yazmaktan güvenilir.
    const tuval = document.createElement("canvas");
    tuval.width = 1;
    tuval.height = 1;
    const ctx = tuval.getContext("2d", { willReadFrequently: true })!;
    const kok = getComputedStyle(document.documentElement);
    const cozumle = (belirtec: string) => {
      const ham = kok.getPropertyValue(belirtec).trim();
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = ham;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    };

    const zemin = cozumle("--color-canvas");
    const yuzey = cozumle("--color-surface");
    const sonuc = {
      "ink/canvas": oran(cozumle("--color-ink"), zemin),
      "muted/canvas": oran(cozumle("--color-muted"), zemin),
      "faint/canvas": oran(cozumle("--color-faint"), zemin),
      "ink/surface": oran(cozumle("--color-ink"), yuzey),
      "muted/surface": oran(cozumle("--color-muted"), yuzey),
      "primary/canvas": oran(cozumle("--color-primary"), zemin),
      "beyaz/primary": oran("rgb(255,255,255)", cozumle("--color-primary")),
      "danger/canvas": oran(cozumle("--color-danger"), zemin),
    };
    return sonuc;
  });

  // Ölçüm çıktısı rapora düşsün: "geçti" demek sayı göstermek değildir.
  console.log("[karşıtlık]", JSON.stringify(olcumler, null, 2));

  // Gövde metni ve bağlantılar: AA normal metin eşiği 4.5.
  expect(olcumler["ink/canvas"]).toBeGreaterThanOrEqual(4.5);
  expect(olcumler["muted/canvas"]).toBeGreaterThanOrEqual(4.5);
  expect(olcumler["ink/surface"]).toBeGreaterThanOrEqual(4.5);
  expect(olcumler["muted/surface"]).toBeGreaterThanOrEqual(4.5);
  expect(olcumler["primary/canvas"]).toBeGreaterThanOrEqual(4.5);
  expect(olcumler["danger/canvas"]).toBeGreaterThanOrEqual(4.5);
  // Birincil düğmenin üstündeki beyaz yazı.
  expect(olcumler["beyaz/primary"]).toBeGreaterThanOrEqual(4.5);
  // `faint` yalnız etiket/ölçek metninde kullanılır; AA büyük metin eşiği 3.
  expect(olcumler["faint/canvas"]).toBeGreaterThanOrEqual(3);
});
