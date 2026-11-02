// Example audience functions for spec/examples/messages/*.yml.
//
// In your app, this file lives at plgkit/audiences.ts.
// Each function's name is what a message's `audience` lists in YAML.
// PLGKit calls each one with the same `context` you pass to decide(),
// and sends only the true/false result to the core. Your user object
// never leaves your app.

// Example shapes. Use whatever your app already has.
type User = {
  id: string;
  username: string;
  countryCode: string; // ISO 3166-1 alpha-2, e.g. "US"
  birthDate?: string; // "YYYY-MM-DD"
  email?: string;
  mobile?: string;
  species?: string; // defaults to "human"
  isStaff?: boolean; // defaults to false
};

type Context = {
  user: User;
  req?: unknown; // your framework's request object, if you need it
};

function ageInYears(birthDate: string, now = new Date()): number {
  const born = new Date(birthDate);
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < born.getUTCMonth() ||
    (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function speciesOf(user: User): string {
  return user.species ?? "human";
}

export const audiences = {
  is_human: ({ user }: Context) => speciesOf(user) === "human",
  is_adult: ({ user }: Context) =>
    user.birthDate != null && ageInYears(user.birthDate) >= 18,
  is_usa_resident: ({ user }: Context) => user.countryCode === "US",
  is_uk_resident: ({ user }: Context) => user.countryCode === "GB",
  is_staff: ({ user }: Context) => user.isStaff ?? false,
  is_duck: ({ user }: Context) => speciesOf(user) === "duck",
};
