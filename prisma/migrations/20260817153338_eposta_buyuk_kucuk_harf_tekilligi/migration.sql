-- E-posta tekilliği büyük/küçük harften bağımsız olmalı (§4.2, §16.1).
--
-- Prisma'nın ürettiği tekil indeks harfe duyarlıydı: `Mudur@ornek.test` ile
-- `mudur@ornek.test` iki ayrı kullanıcı olarak kaydedilebiliyordu. Giriş şeması
-- ise adresi küçük harfe çevirdiği için aynı kişi iki kimliğe bölünebilir,
-- kilit ve parola sıfırlama yanlış kayda uygulanabilirdi
-- (denetim 17.08.2026, bulgu 11).
--
-- Not: Bu indeks harfe duyarlı olanın yerine geçmez, ona eklenir. Uygulama
-- e-postayı her zaman küçük harfe çevirerek saklar; indeks o kuralın
-- delinemeyeceğini garanti eder.

CREATE UNIQUE INDEX "User_email_lower_idx" ON "User" (lower("email"));
