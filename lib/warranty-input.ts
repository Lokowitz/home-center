import { z } from "zod"
import { ASSET_TYPES } from "@/lib/assets"
import { nameText, optionalDateText, optionalNameText, parseDateOnly } from "@/lib/input-limits"

// Shared by the warranty actions and the warranty dialog, so both apply the same rules.

export const warrantySchema = z
  .object({
    assetId: z.string().min(1),
    assetType: z.enum(ASSET_TYPES),
    productName: nameText("Product name is required"),
    purchaseDate: optionalDateText,
    expirationDate: optionalDateText,
    vendor: optionalNameText,
    vendorPhone: z.string().optional(),
    vendorEmail: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    const bought = v.purchaseDate ? parseDateOnly(v.purchaseDate) : null
    const expires = v.expirationDate ? parseDateOnly(v.expirationDate) : null
    if (bought && expires && expires < bought) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expirationDate"], message: "Expiration can't be before the purchase date." })
    }
  })

export type WarrantyInput = z.infer<typeof warrantySchema>
