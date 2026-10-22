-- Link equipment whose free-text location is exactly the name of a room on its property
-- (ignoring case and surrounding spaces), then clear the text: the link now says where it is.
-- Only when exactly one room on the property has that name; ambiguous names stay as text.
UPDATE "Equipment"
SET "roomId" = (
      SELECT r."id" FROM "Room" r
      WHERE r."propertyId" = "Equipment"."propertyId"
        AND lower(trim(r."name")) = lower(trim("Equipment"."location"))
    ),
    "location" = NULL
WHERE "roomId" IS NULL
  AND "propertyId" IS NOT NULL
  AND trim("location") <> ''
  AND (
    SELECT count(*) FROM "Room" r
    WHERE r."propertyId" = "Equipment"."propertyId"
      AND lower(trim(r."name")) = lower(trim("Equipment"."location"))
  ) = 1;
