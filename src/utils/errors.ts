export class PublicError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
