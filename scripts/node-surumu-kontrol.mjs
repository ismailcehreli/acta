// Doğrulama komutları hedef çalışma zamanında koşmalı: Node 22'ye geçildi ama
// yerelde Node 20 ile koşan testler, üretimde çalışacak API yüzeyini
// kullanmıyordu (denetim 18.08.2026, bulgu 9).

const gereken = 22;
const [buyuk] = process.versions.node.split(".").map(Number);

if (buyuk < gereken) {
  console.error(
    [
      "",
      `Bu proje Node ${gereken} ile çalışır; şu an Node ${process.versions.node} kullanılıyor.`,
      "Node 20'nin destek süresi doldu ve üretim imajı Node 22 kullanıyor;",
      "doğrulamanın hedef çalışma zamanında koşması gerekir.",
      "",
      "Geçiş için:  nvm install 22 && nvm use",
      "(Sürüm .nvmrc dosyasında yazılı.)",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
