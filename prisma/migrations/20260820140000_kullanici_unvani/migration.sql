-- Kullanıcı unvanı (ürün sahibi isteği, 20.08.2026).
--
-- Serbest metin ve **yetki değildir**: görünürlük, onay ve yöneticilik yine
-- organizasyon ağacından gelir. Unvan yalnızca "bu kaydı yazan kişi ne iş
-- yapıyor" sorusuna cevap verir — kayıt listesinde ve profilde görünür.
--
-- Boş bırakılabilir: mevcut kullanıcıların unvanı yoktur ve zorunlu bir alan
-- hâline getirilmesi, kurulumu olan sistemlerde her hesabı elle düzenlemeyi
-- gerektirirdi.

ALTER TABLE "User" ADD COLUMN "title" VARCHAR(100);
