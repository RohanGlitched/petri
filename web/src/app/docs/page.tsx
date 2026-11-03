import { redirect } from "next/navigation";

// Every docs page sits one level below /docs, so links between them can be relative and work on both hosts. The
// introduction lives at /docs/introduction (and at the root of docs.playpetri.xyz).
export default function DocsIndex() {
  redirect("/docs/introduction");
}
