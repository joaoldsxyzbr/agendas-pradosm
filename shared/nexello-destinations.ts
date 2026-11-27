import { z } from "zod";
export const NexelloDestinationSchema=z.object({
  externalCode:z.string(),dock:z.string(),storeId:z.string(),storeCode:z.string(),storeName:z.string(),
  active:z.boolean(),createdAt:z.string(),
});
export const NexelloDestinationsSchema=z.array(NexelloDestinationSchema);
export const LinkNexelloDestinationSchema=z.object({storeId:z.string().uuid()}).strict();
export type NexelloDestination=z.infer<typeof NexelloDestinationSchema>;
