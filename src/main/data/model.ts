export interface IdentifiedRecord {
  id: number
}

export interface ModelPersistence<TRecord extends IdentifiedRecord> {
  find: (id: number) => TRecord | null
  delete: (id: number) => boolean
}

export class ModelNotFoundError extends Error {
  constructor(modelName: string, id: number) {
    super(`${modelName} ${id} does not exist`)
    this.name = 'ModelNotFoundError'
  }
}

export class ModelValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelValidationError'
  }
}

/**
 * ActiveRecord-like lifecycle helpers without hiding SQL or domain behavior.
 * Subclasses add meaningful operations while repositories own persistence.
 */
export abstract class BaseModel<TRecord extends IdentifiedRecord> {
  private deleted = false

  protected constructor(
    protected readonly persistence: ModelPersistence<TRecord>,
    protected record: TRecord
  ) {}

  get id(): number {
    return this.record.id
  }

  get isDeleted(): boolean {
    return this.deleted
  }

  refresh(): this {
    this.assertPersisted()
    const record = this.persistence.find(this.id)
    if (!record) throw new ModelNotFoundError(this.constructor.name, this.id)
    this.record = record
    return this
  }

  delete(): boolean {
    this.assertPersisted()
    const deleted = this.persistence.delete(this.id)
    this.deleted = deleted
    return deleted
  }

  protected replace(record: TRecord): this {
    this.record = record
    return this
  }

  protected assertPersisted(): void {
    if (this.deleted) throw new ModelValidationError(`${this.constructor.name} has been deleted`)
  }
}

export abstract class BaseRepository<
  TRecord extends IdentifiedRecord,
  TModel extends BaseModel<TRecord>
> implements ModelPersistence<TRecord>
{
  abstract find(id: number): TRecord | null
  abstract delete(id: number): boolean
  protected abstract instantiate(record: TRecord): TModel

  findModel(id: number): TModel | null {
    const record = this.find(id)
    return record ? this.instantiate(record) : null
  }

  requireModel(id: number): TModel {
    const model = this.findModel(id)
    if (!model) throw new ModelNotFoundError(this.constructor.name, id)
    return model
  }
}
