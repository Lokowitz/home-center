import type { FieldHelpMap } from "./types"

export const ASSET_HELP: FieldHelpMap = {
  "property.name": {
    title: "Name",
    what: "What you call this place, like Main House or Lake Cabin.",
    use: "Shows in lists, menus and search. Files dropped into Intake are matched to this property when its name appears in them.",
  },
  "property.type": {
    title: "Type",
    what: "What kind of property this is.",
    use: "Shows on the property's page and in the list, and picks which default reminders are offered.",
    values: [
      { label: "House, Townhouse or Other", effect: "Offered the full set of default home reminders." },
      { label: "Condo", effect: "Default reminders skip gutters, HVAC service and sprinklers." },
      { label: "Lot / Land", effect: "Offered a short list of reminders for land." },
    ],
  },
  "property.year-built": {
    title: "Year Built",
    what: "The year the building went up.",
    use: "Shows on the property's page and in the property list.",
  },
  "property.address": {
    title: "Address",
    what: "The street address of the property.",
    use: "Files dropped into Intake that mention the first line of this address are matched to this property.",
  },
  "property.purchase-date": {
    title: "Purchase Date",
    what: "The day you bought the property.",
    use: "Cost per year owned on the property's page counts from here.",
  },
  "property.purchase-price": {
    title: "Purchase Price",
    what: "What you paid for the property.",
    use: "Added to the property's total owned cost on its page.",
  },
  "property.area": {
    title: "Square footage",
    what: "The size of the home. It reads Floor area (m²) when your regional settings use metres.",
    use: "Shows on the property's page and in the property list. Changing the unit later doesn't convert the number.",
  },
  "property.notes": {
    title: "Notes",
    what: "Anything else worth keeping about the property, like gate codes or the HOA contact.",
    use: "Shows on the property's page.",
  },
  "property.insurance": {
    title: "Insurance",
    what: "The policies that cover this property, such as home, renters or umbrella.",
    use: "Ticked policies show in the Insurance box on this page and list this property on the Insurance page. Unticking one removes only this property from it.",
  },

  "vehicle.name": {
    title: "Nickname",
    what: "What you call this vehicle, like Family SUV or Dad's truck.",
    use: "Shows in lists, reminders and search. Files dropped into Intake are matched to it when the nickname appears in them.",
  },
  "vehicle.year": {
    title: "Year",
    what: "The model year.",
    use: "Shows on the vehicle's page.",
  },
  "vehicle.make": {
    title: "Make",
    what: "The brand, like Toyota or Ford.",
    use: "Together with the model, used to match files dropped into Intake to this vehicle.",
  },
  "vehicle.model": {
    title: "Model",
    what: "The model name, like RAV4 or F-150.",
    use: "Together with the make, used to match files dropped into Intake to this vehicle.",
  },
  "vehicle.color": {
    title: "Color",
    what: "The paint color.",
    use: "Shows on the vehicle's page.",
  },
  "vehicle.purchase-date": {
    title: "Purchase Date",
    what: "The day you bought the vehicle.",
    use: "Cost per year owned on the vehicle's page counts from here.",
  },
  "vehicle.purchase-price": {
    title: "Purchase Price",
    what: "What you paid for the vehicle.",
    use: "Added to the vehicle's total owned cost on its page.",
  },
  "vehicle.current-mileage": {
    title: "Current Mileage",
    what: "What the odometer (or hour meter) reads now.",
    use: "Reminders compare their due mileage with it to show due soon or overdue. Marking a reminder done with a higher reading updates it.",
  },
  "vehicle.tracked-in": {
    title: "Tracked In",
    what: "What the vehicle's meter counts.",
    values: [
      { label: "Miles (or Kilometres)", effect: "For cars and trucks. Shows miles or km, following your regional settings." },
      { label: "Hours", effect: "For tractors, mowers or boats with an hour meter. Default reminders switch to hour-based ones." },
    ],
  },
  "vehicle.vin": {
    title: "VIN",
    what: "The 17-character vehicle identification number, found on the dashboard, door frame or registration.",
    use: "Files dropped into Intake that mention it are matched to this vehicle first.",
  },
  "vehicle.notes": {
    title: "Notes",
    what: "Anything else worth keeping about the vehicle, like tire size or the plate number.",
    use: "Shows on the vehicle's page.",
  },
  "vehicle.insurance": {
    title: "Insurance",
    what: "The policies that cover this vehicle, such as auto or umbrella.",
    use: "Ticked policies show in the Insurance box on this page and list this vehicle on the Insurance page. Unticking one removes only this vehicle from it.",
  },
  "vehicle.property": {
    title: "Property",
    what: "The property this vehicle belongs to.",
    use: "With the property filter on, a property with any vehicles linked shows only those. A property with none linked shows every vehicle.",
  },

  "room.name": {
    title: "Name",
    what: "What you call this room, like Kitchen or Primary bedroom.",
    use: "Offered in the Room picker on reminders and service records. Equipment whose Location matches the name is linked to this room.",
  },
  "room.level": {
    title: "Level",
    what: "The floor the room is on, like Main floor or Basement.",
    use: "Shows beside the room's name in the room list.",
  },
  "room.area": {
    title: "Square footage",
    what: "The room's floor size. It reads Floor area (m²) when your regional settings use metres.",
    use: "Shows on the room card. Changing the unit later doesn't convert the number.",
  },
  "room.dimensions": {
    title: "Dimensions",
    what: "The room's size as you'd say it, like 14 × 16 ft.",
    use: "Shows on the room card next to the area.",
  },
  "room.flooring": {
    title: "Flooring",
    what: "The type of floor, like Hardwood or Tile. Pick a suggestion or type your own.",
    use: "Shows on the room card and is searchable in the room list.",
  },
  "room.flooring-product": {
    title: "Flooring product",
    what: "The brand, product line and color of the floor, so you can buy more to match.",
    use: "Shows on the room card and is searchable in the room list.",
  },
  "room.flooring-installed": {
    title: "Flooring installed",
    what: "The day the current floor went in.",
  },
  "room.paint": {
    title: "Paint",
    what: "Paint used in this room, one row per surface: walls, ceiling, trim and so on. Add the brand, color name, code and finish so you can buy the same paint again.",
    use: "The first one shows on the room card. A row needs a surface once anything else is filled in.",
  },
  "room.notes": {
    title: "Notes",
    what: "Anything else worth keeping about the room.",
  },
  "room.select": {
    title: "Room",
    what: "The room in this property where the work happens. Optional.",
    use: "Shows as a tag on the row, and the item is listed in that room's tabs.",
  },
}
