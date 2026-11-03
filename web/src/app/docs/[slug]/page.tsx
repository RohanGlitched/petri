import { notFound } from "next/navigation";

// Every real docs page is its own folder; any other slug is a docs 404, shown inside the docs layout.
export default function Unknown() {
  notFound();
}
