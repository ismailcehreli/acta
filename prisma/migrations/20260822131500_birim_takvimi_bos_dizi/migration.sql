-- Boş çalışma günü dizisi kısıtı düzeltmesi (Görev 11.9).
--
-- Önceki kısıt `array_length("workingDays", 1) BETWEEN 1 AND 7` yazıyordu.
-- PostgreSQL'de **boş dizinin uzunluğu NULL'dur**, sıfır değil; `NULL BETWEEN`
-- de NULL üretir ve CHECK kısıtı NULL'ı kabul eder. Yani boş dizi geçiyordu.
--
-- Kısıtın reddedilme testi bunu yakaladı: kısıt yazmak yetmiyor, reddettiğini
-- görmek gerekiyor.

ALTER TABLE "OrgUnitWorkCalendar"
  DROP CONSTRAINT "OrgUnitWorkCalendar_valid_days";

ALTER TABLE "OrgUnitWorkCalendar"
  ADD CONSTRAINT "OrgUnitWorkCalendar_valid_days"
  CHECK (
    COALESCE(array_length("workingDays", 1), 0) BETWEEN 1 AND 7
    AND "workingDays" <@ ARRAY[1,2,3,4,5,6,7]
  );
