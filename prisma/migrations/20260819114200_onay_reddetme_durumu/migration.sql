-- Reddetme durumu (§5.4, ürün sahibi kararı 19.08.2026).
--
-- Ayrı bir geçiş dosyası olmasının sebebi teknik: PostgreSQL'de bir enum'a
-- eklenen yeni değer **aynı işlem içinde kullanılamaz.** Bir sonraki geçiş
-- 'REJECTED' değerini CHECK kısıtlarında kullanıyor; bu yüzden değerin
-- eklenmesi kendi işleminde kalmak zorunda.

ALTER TYPE "ActivityApprovalStatus" ADD VALUE 'REJECTED';
