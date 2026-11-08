// @ts-expect-error Runtime ESM entry; the matching declaration exports follow below.
import * as clientSdk from '../node_modules/spacetimedb/dist/sdk/index.mjs';
// @ts-expect-error Runtime ESM entry; the matching declaration exports follow below.
import * as sharedSdk from '../node_modules/spacetimedb/dist/index.mjs';

export const convertToAccessorMap = clientSdk.convertToAccessorMap;
export const makeQueryBuilder = sharedSdk.makeQueryBuilder;
export const procedureSchema = clientSdk.procedureSchema;
export const procedures = clientSdk.procedures;
export const reducerSchema = clientSdk.reducerSchema;
export const reducers = clientSdk.reducers;
export const schema = clientSdk.schema;
export const t = clientSdk.t;
export const table = clientSdk.table;

type UntypedRemoteModule = import('../node_modules/spacetimedb/dist/sdk/spacetime_module.js').UntypedRemoteModule;
type AlgebraicType = import('../node_modules/spacetimedb/dist/lib/algebraic_type.js').AlgebraicType;
const ConnectionImplBase = clientSdk.DbConnectionImpl as new (...args: any[]) => object;
const ConnectionBuilderBase = clientSdk.DbConnectionBuilder as new (...args: any[]) => object;
const SubscriptionBuilderBase = clientSdk.SubscriptionBuilderImpl as new (...args: any[]) => object;
const TypeBuilderBase = clientSdk.TypeBuilder as new (...args: any[]) => object;
const UuidBase = sharedSdk.Uuid as new (...args: any[]) => object;

export class DbConnectionImpl<Module extends UntypedRemoteModule> extends ConnectionImplBase {
  declare db: import('../node_modules/spacetimedb/dist/sdk/index.js').DbContext<Module>['db'];
  constructor(...args: any[]) { super(...args); }
  subscriptionBuilder(): SubscriptionBuilderImpl<Module> { return null as never; }
}
export class DbConnectionBuilder<Connection extends DbConnectionImpl<any>> extends ConnectionBuilderBase { constructor(...args: any[]) { super(...args); } }
export class SubscriptionBuilderImpl<RemoteModule extends UntypedRemoteModule> extends SubscriptionBuilderBase { constructor(...args: any[]) { super(...args); } }
export class TypeBuilder<Type, SpacetimeType extends AlgebraicType> extends TypeBuilderBase { constructor(...args: any[]) { super(...args); } }
export class Uuid extends UuidBase { constructor(...args: any[]) { super(...args); } }

export type AlgebraicTypeType = import('../node_modules/spacetimedb/dist/lib/algebraic_type.js').AlgebraicTypeType;
export type Infer<T> = import('../node_modules/spacetimedb/dist/lib/type_builders.js').Infer<T>;
export type DbConnectionConfig<RemoteModule extends UntypedRemoteModule> = import('../node_modules/spacetimedb/dist/sdk/index.js').DbConnectionConfig<RemoteModule>;
export type ErrorContextInterface<RemoteModule extends UntypedRemoteModule> = import('../node_modules/spacetimedb/dist/sdk/index.js').ErrorContextInterface<RemoteModule>;
export type Event<RemoteModule extends UntypedRemoteModule> = import('../node_modules/spacetimedb/dist/sdk/index.js').Event<RemoteModule>;
export type EventContextInterface<RemoteModule extends UntypedRemoteModule> = import('../node_modules/spacetimedb/dist/sdk/index.js').EventContextInterface<RemoteModule>;
export type QueryBuilder<SchemaDef extends import('../node_modules/spacetimedb/dist/lib/schema.js').UntypedSchemaDef> = import('../node_modules/spacetimedb/dist/lib/query.js').QueryBuilder<SchemaDef>;
export type ReducerEventContextInterface<RemoteModule extends UntypedRemoteModule> = import('../node_modules/spacetimedb/dist/sdk/index.js').ReducerEventContextInterface<RemoteModule>;
export type RemoteModule<SchemaDef extends import('../node_modules/spacetimedb/dist/lib/schema.js').UntypedSchemaDef, ReducersDef extends import('../node_modules/spacetimedb/dist/sdk/reducers.js').UntypedReducersDef, ProceduresDef extends import('../node_modules/spacetimedb/dist/sdk/procedures.js').UntypedProceduresDef> = import('../node_modules/spacetimedb/dist/sdk/spacetime_module.js').RemoteModule<SchemaDef, ReducersDef, ProceduresDef>;
export type SubscriptionEventContextInterface<RemoteModule extends UntypedRemoteModule> = import('../node_modules/spacetimedb/dist/sdk/index.js').SubscriptionEventContextInterface<RemoteModule>;
export type SubscriptionHandleImpl<RemoteModule extends UntypedRemoteModule> = import('../node_modules/spacetimedb/dist/sdk/index.js').SubscriptionHandleImpl<RemoteModule>;
