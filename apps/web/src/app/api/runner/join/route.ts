import { joinRunner } from "@foundry/control";
import { JoinRequestSchema } from "@foundry/shared";
import { getContext } from "@/server/context";
import { errorResponse, json } from "@/server/http";

export async function POST(req: Request) {
  try {
    const body = JoinRequestSchema.parse(await req.json());
    return json(await joinRunner(await getContext(), body));
  } catch (err) {
    return errorResponse(err);
  }
}
